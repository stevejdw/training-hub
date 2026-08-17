import { Pool } from 'pg';
import { instrumentPool } from './db-metrics';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

/**
 * Pasting a whole `KEY=value` line into a secrets UI stores the key as part of
 * the value. `pg` then parses the host out of the wrong place and every query
 * fails with `getaddrinfo ENOTFOUND base`, which reads like a DNS fault rather
 * than a malformed setting — production was down for two days on exactly this.
 */
function connectionString(): string {
  const raw = process.env.DATABASE_URL!.trim().replace(/^DATABASE_URL\s*=\s*/, '');
  if (!/^postgres(ql)?:\/\//.test(raw)) {
    throw new Error(
      'DATABASE_URL is not a postgres connection string. It must start with ' +
      'postgresql:// — check the stored value does not include the variable ' +
      'name or surrounding quotes.'
    );
  }
  return raw;
}

const pool = new Pool({
  connectionString: connectionString(),
  ssl: { rejectUnauthorized: false },
  max: 5,
  connectionTimeoutMillis: 10_000,
});

// Measures bytes read out of Postgres per query — see lib/db-metrics.ts.
// Set EGRESS_METRICS=off to disable.
export default instrumentPool(pool);
