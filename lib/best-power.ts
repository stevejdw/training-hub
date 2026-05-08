import pool from './db';
import { CYCLING_TYPES } from './sport-types';

/**
 * Shared best-power interval definitions and compute logic.
 *
 * Every interval below gets computed once per activity (when the power stream
 * is synced) and stored in the `best_power_efforts` table.  All charts then
 * read from that single source of truth.
 */

/* ── All intervals we track ─────────────────────────────────────────── */

export interface BestPowerInterval {
  label: string;
  seconds: number;
}

export const BEST_POWER_INTERVALS: BestPowerInterval[] = [
  { label: '1 sec',  seconds: 1 },
  { label: '3 sec',  seconds: 3 },
  { label: '5 sec',  seconds: 5 },
  { label: '10 sec', seconds: 10 },
  { label: '30 sec', seconds: 30 },
  { label: '1 min',  seconds: 60 },
  { label: '2 min',  seconds: 120 },
  { label: '3 min',  seconds: 180 },
  { label: '5 min',  seconds: 300 },
  { label: '8 min',  seconds: 480 },
  { label: '10 min', seconds: 600 },
  { label: '15 min', seconds: 900 },
  { label: '20 min', seconds: 1200 },
  { label: '30 min', seconds: 1800 },
  { label: '45 min', seconds: 2700 },
  { label: '60 min', seconds: 3600 },
  { label: '90 min', seconds: 5400 },
  { label: '2 hr',   seconds: 7200 },
  { label: '3 hr',   seconds: 10800 },
  { label: '4 hr',   seconds: 14400 },
  { label: '5 hr',   seconds: 18000 },
  { label: '6 hr',   seconds: 21600 },
  { label: '7 hr',   seconds: 25200 },
  { label: '8 hr',   seconds: 28800 },
  { label: '9 hr',   seconds: 32400 },
  { label: '10 hr',  seconds: 36000 },
  { label: '11 hr',  seconds: 39600 },
  { label: '12 hr',  seconds: 43200 },
  { label: '15 hr',  seconds: 54000 },
];

/* ── Compute best power for all intervals from a raw power stream ──── */

export interface BestPowerResult {
  seconds: number;
  best_watts: number | null;
}

/**
 * Compute the best rolling-average power for every standard interval
 * from a raw 1-second power array.
 *
 * Uses a single O(n) sliding-window pass per interval — fast enough
 * to run synchronously during activity sync even for 10+ hour rides.
 *
 * For intervals longer than the stream length, returns null
 * (the calling code may fall back to NP/AP for very long efforts).
 */
export function computeBestPower(watts: (number | null)[]): BestPowerResult[] {
  const clean = watts.map(w => w ?? 0);
  const len   = clean.length;
  if (len === 0) return BEST_POWER_INTERVALS.map(iv => ({ seconds: iv.seconds, best_watts: null }));

  return BEST_POWER_INTERVALS.map(({ seconds }) => {
    if (len < seconds) return { seconds, best_watts: null };

    // Sliding window sum
    let sum = 0;
    for (let i = 0; i < seconds; i++) sum += clean[i];
    let max = sum;

    for (let i = seconds; i < len; i++) {
      sum += clean[i] - clean[i - seconds];
      if (sum > max) max = sum;
    }

    return { seconds, best_watts: Math.round(max / seconds) };
  });
}

/** Ensure best_power_efforts table with denormalized columns and indexes. */
export async function ensureBestPowerTable(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS best_power_efforts (
        activity_id  BIGINT       NOT NULL,
        seconds      INT          NOT NULL,
        best_watts   NUMERIC(10,1),
        start_date   TIMESTAMPTZ,
        sport_type   TEXT,
        PRIMARY KEY (activity_id, seconds)
      )
    `);
    // Add denormalized columns idempotently
    await client.query(`ALTER TABLE best_power_efforts ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ`);
    await client.query(`ALTER TABLE best_power_efforts ADD COLUMN IF NOT EXISTS sport_type TEXT`);
    // Index for the queries we actually run: filter by seconds + date, order by best_watts
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bpe_lookup ON best_power_efforts(seconds, start_date DESC, best_watts DESC)`);
  } finally {
    client.release();
  }
}

/**
 * Warm activities that are missing from best_power_efforts — processes
 * up to `limit` activities. Call this WITHOUT await on read paths so
 * the table fills in the background across requests.
 */
export async function warmMissingActivities(
  limit: number = 500,
): Promise<{ processed: number; done: boolean }> {
  const client = await pool.connect();
  try {
    // Find activities with power streams that are missing from best_power_efforts
    const missingRes = await client.query(`
      SELECT a.id, a.start_date, a.sport_type
      FROM activities a
      JOIN activity_streams s ON s.activity_id = a.id
      WHERE a.sport_type = ANY($1::text[])
        AND array_length(s.watts, 1) > 0
        AND NOT EXISTS (
          SELECT 1 FROM best_power_efforts bpe
          WHERE bpe.activity_id = a.id
        )
      ORDER BY a.start_date DESC
      LIMIT $2
    `, [CYCLING_TYPES, limit]);

    const rows = missingRes.rows as { id: number; start_date: string; sport_type: string }[];
    if (rows.length === 0) return { processed: 0, done: true };

    const ids = rows.map(r => r.id);

    // Fetch all streams for these activities in one query
    const streamsRes = await client.query(`
      SELECT activity_id, watts FROM activity_streams
      WHERE activity_id = ANY($1::bigint[])
    `, [ids]);

    const streamMap = new Map<number, (number | null)[]>();
    for (const row of streamsRes.rows) {
      streamMap.set(row.activity_id as number, row.watts as (number | null)[]);
    }

    // Build a lookup for start_date + sport_type per activity
    const metaMap = new Map<number, { start_date: string; sport_type: string }>();
    for (const r of rows) {
      metaMap.set(r.id, { start_date: r.start_date, sport_type: r.sport_type });
    }

    let processed = 0;
    for (const id of ids) {
      const watts = streamMap.get(id);
      if (!watts || watts.length === 0) continue;

      const results = computeBestPower(watts);
      const meta = metaMap.get(id);

      const valueClauses: string[] = [];
      const valueParams: unknown[] = [];
      for (const r of results) {
        if (r.best_watts != null) {
          valueClauses.push(`($${valueParams.length + 1}, $${valueParams.length + 2}, $${valueParams.length + 3}, $${valueParams.length + 4}::timestamptz, $${valueParams.length + 5})`);
          valueParams.push(id, r.seconds, r.best_watts, meta?.start_date ?? null, meta?.sport_type ?? null);
        }
      }
      if (valueClauses.length > 0) {
        await client.query(`
          INSERT INTO best_power_efforts (activity_id, seconds, best_watts, start_date, sport_type)
          VALUES ${valueClauses.join(', ')}
          ON CONFLICT (activity_id, seconds) DO UPDATE SET
            best_watts = EXCLUDED.best_watts,
            start_date = COALESCE(best_power_efforts.start_date, EXCLUDED.start_date),
            sport_type = COALESCE(best_power_efforts.sport_type, EXCLUDED.sport_type)
        `, valueParams);
      }
      processed++;
    }

    return { processed, done: rows.length < limit };
  } finally {
    client.release();
  }
}
