import type { PoolClient } from 'pg';

/**
 * Precomputed half-ride power/HR averages, the inputs to aerobic efficiency
 * and decoupling.
 *
 * The chart used to derive these on every load by unnesting the stored 1 Hz
 * watts/hr arrays — roughly 500ms per ride, because a long ride holds tens of
 * thousands of samples. That was tolerable while few rides had power; once the
 * Garmin backfill populated normalized_power on ~2,200 rides the 6-month and
 * longer ranges exceeded the route timeout and returned nothing.
 *
 * The averages only change when the underlying stream changes, so they are
 * computed once and stored — the same approach as best_power_efforts. Four
 * floats per ride, so a full year of rides costs a few KB to read instead of
 * hundreds of megabytes of array egress.
 */

/** Idempotent DDL. Safe to call on every request. */
export async function ensureEfficiencyTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS activity_efficiency (
      activity_id BIGINT PRIMARY KEY,
      pw1         DOUBLE PRECISION,
      hr1         DOUBLE PRECISION,
      pw2         DOUBLE PRECISION,
      hr2         DOUBLE PRECISION,
      samples     INTEGER,
      computed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

/**
 * Compute and store halves for rides that have streams but no row yet.
 *
 * Bounded by `limit` so it can run inside a request without risking the
 * function timeout; the caller invokes it from `after()` so the response is
 * never blocked. Returns how many were processed.
 */
export async function warmMissingEfficiency(
  client: PoolClient,
  limit = 25
): Promise<number> {
  await ensureEfficiencyTable(client);
  const res = await client.query<{ n: string }>(`
    WITH todo AS MATERIALIZED (
      SELECT s.activity_id
        FROM activity_streams s
        LEFT JOIN activity_efficiency e ON e.activity_id = s.activity_id
       WHERE e.activity_id IS NULL
         AND s.watts IS NOT NULL AND s.hr IS NOT NULL
         AND array_length(s.watts, 1) > 60
         AND array_length(s.hr, 1)    > 60
       ORDER BY s.activity_id DESC
       LIMIT $1
    ), computed AS (
      SELECT t.activity_id, dims.n AS samples,
             COALESCE(AVG(x.wv) FILTER (WHERE x.ord <= dims.n / 2), 0) AS pw1,
             COALESCE(AVG(x.hv) FILTER (WHERE x.ord <= dims.n / 2), 0) AS hr1,
             COALESCE(AVG(x.wv) FILTER (WHERE x.ord >  dims.n / 2 AND x.ord <= dims.n), 0) AS pw2,
             COALESCE(AVG(x.hv) FILTER (WHERE x.ord >  dims.n / 2 AND x.ord <= dims.n), 0) AS hr2
        FROM todo t
        JOIN activity_streams s ON s.activity_id = t.activity_id
        CROSS JOIN LATERAL (
          SELECT LEAST(array_length(s.watts, 1), array_length(s.hr, 1)) AS n
        ) dims
        CROSS JOIN LATERAL unnest(s.watts, s.hr) WITH ORDINALITY AS x(wv, hv, ord)
       WHERE x.wv IS NOT NULL AND x.hv IS NOT NULL AND x.hv > 30
       GROUP BY t.activity_id, dims.n
    ), ins AS (
      INSERT INTO activity_efficiency (activity_id, pw1, hr1, pw2, hr2, samples)
      SELECT activity_id, pw1, hr1, pw2, hr2, samples FROM computed
      ON CONFLICT (activity_id) DO UPDATE SET
        pw1 = EXCLUDED.pw1, hr1 = EXCLUDED.hr1,
        pw2 = EXCLUDED.pw2, hr2 = EXCLUDED.hr2,
        samples = EXCLUDED.samples, computed_at = NOW()
      RETURNING 1
    )
    SELECT count(*)::text AS n FROM ins
  `, [limit]);
  return Number(res.rows[0]?.n ?? 0);
}

/** Rides with streams still awaiting a precomputed row. */
export async function pendingEfficiencyCount(client: PoolClient): Promise<number> {
  await ensureEfficiencyTable(client);
  const res = await client.query<{ n: string }>(`
    SELECT count(*)::text AS n
      FROM activity_streams s
      LEFT JOIN activity_efficiency e ON e.activity_id = s.activity_id
     WHERE e.activity_id IS NULL
       AND s.watts IS NOT NULL AND s.hr IS NOT NULL
       AND array_length(s.watts, 1) > 60
       AND array_length(s.hr, 1)    > 60
  `);
  return Number(res.rows[0]?.n ?? 0);
}
