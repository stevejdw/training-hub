import type { Pool, PoolClient, QueryResult } from 'pg';

/**
 * Database egress instrumentation.
 *
 * Neon's free-plan quota meters bytes leaving the database, which is not the
 * same as bytes leaving Vercel — /api/activities/[id]/zones pulls two full 1 Hz
 * arrays out of Postgres and returns a small histogram. Measuring HTTP response
 * sizes would rank that route as cheap, so we measure at the pg layer instead.
 *
 * Every result set above EGRESS_MIN_BYTES is logged as a single `[egress]` line.
 * We deliberately do not attach a route name here: Vercel already groups log
 * lines under the request that produced them, so the path comes for free when
 * the logs are read back, without calling headers() (which would opt server
 * components into dynamic rendering as a side effect).
 *
 * Set EGRESS_METRICS=off to disable.
 */

const ENABLED = process.env.EGRESS_METRICS !== 'off';

/** Result sets smaller than this are not worth a log line. */
const MIN_BYTES = Number(process.env.EGRESS_MIN_BYTES ?? 1024);

/**
 * Approximate the wire cost of a result set.
 *
 * JSON is not the Postgres wire format, so these are relative magnitudes for
 * ranking queries against each other — not exact billing figures. Int arrays
 * are the dominant cost here and encode similarly in both, so the ranking holds
 * even though the absolute number will not match Neon's meter.
 */
export function estimateBytes(rows: unknown): number {
  try {
    const json = JSON.stringify(rows);
    return json ? Buffer.byteLength(json, 'utf8') : 0;
  } catch {
    return 0; // circular or non-serialisable — not something our queries return
  }
}

/** Collapse a query to a single short line so log output stays greppable. */
function normalizeSql(sql: unknown): string {
  const text =
    typeof sql === 'string'
      ? sql
      : typeof sql === 'object' && sql !== null && 'text' in sql
        ? String((sql as { text: unknown }).text)
        : '<unknown>';
  return text.replace(/\s+/g, ' ').trim().slice(0, 140);
}

function record(sql: unknown, res: QueryResult | undefined, ms: number): void {
  const bytes = estimateBytes(res?.rows);
  if (bytes < MIN_BYTES) return;
  console.log(
    `[egress] ${JSON.stringify({
      bytes,
      rows: res?.rowCount ?? 0,
      ms,
      sql: normalizeSql(sql),
    })}`,
  );
}

/** Wrap a checked-out client so its query results are measured. */
function wrapClient(client: PoolClient): PoolClient {
  return new Proxy(client, {
    get(target, prop) {
      // Receiver is the raw client, not the proxy: a getter that reads another
      // property must not re-enter this trap.
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;

      // Bind to the raw client: pg reaches for internal state via `this`, and
      // release() in particular must not see the proxy.
      const bound = value.bind(target);
      if (prop !== 'query') return bound;

      return function instrumentedQuery(...args: unknown[]) {
        // Callback-style query — pass straight through rather than guess at
        // the shape of the result.
        if (typeof args[args.length - 1] === 'function') {
          return bound(...args);
        }

        const started = Date.now();
        const result = bound(...args);

        if (result && typeof (result as Promise<unknown>).then === 'function') {
          return (result as Promise<QueryResult>).then(res => {
            record(args[0], res, Date.now() - started);
            return res;
          });
        }
        return result;
      };
    },
  });
}

/**
 * Instrument a pool in place. Returns the same pool so it can wrap an export
 * directly; call sites using `pool.connect()` need no changes.
 */
export function instrumentPool(pool: Pool): Pool {
  if (!ENABLED) return pool;

  const originalConnect = pool.connect.bind(pool);

  // pg types connect() with both promise and callback overloads; we only
  // instrument the promise form the app actually uses.
  pool.connect = function connect(...args: unknown[]) {
    if (args.length > 0) {
      return (originalConnect as (...a: unknown[]) => unknown)(...args);
    }
    return originalConnect().then(wrapClient);
  } as typeof pool.connect;

  const originalQuery = pool.query.bind(pool);
  pool.query = function query(...args: unknown[]) {
    if (typeof args[args.length - 1] === 'function') {
      return (originalQuery as (...a: unknown[]) => unknown)(...args);
    }
    const started = Date.now();
    const result = (originalQuery as (...a: unknown[]) => unknown)(...args);
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      return (result as Promise<QueryResult>).then(res => {
        record(args[0], res, Date.now() - started);
        return res;
      });
    }
    return result;
  } as typeof pool.query;

  return pool;
}
