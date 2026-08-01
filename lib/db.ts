import { Pool } from 'pg';
import { instrumentPool } from './db-metrics';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  connectionTimeoutMillis: 10_000,
});

// Measures bytes read out of Postgres per query — see lib/db-metrics.ts.
// Set EGRESS_METRICS=off to disable.
export default instrumentPool(pool);
