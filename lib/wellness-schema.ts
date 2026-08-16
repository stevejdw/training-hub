import type { PoolClient } from 'pg';

/**
 * Garmin-native wellness columns on `daily_wellness`.
 *
 * The table keeps `PRIMARY KEY (date)` — one row per day, with `source`
 * recording who won. A composite (date, source) key would double the row count
 * and force a precedence CTE into every analytics route; instead precedence is
 * resolved at write time (Garmin wins, intervals.icu defers) so all the read
 * paths stay plain queries.
 *
 * Everything here is a narrow scalar: ~100 bytes per row, so a 365-day read
 * grows by ~36 KB. That is deliberate given the Neon egress budget — the raw
 * Garmin payloads go in `daily_wellness_raw`, a table no hot path joins to, so
 * a careless `SELECT *` on the readiness chart can't pull megabytes.
 *
 * Intraday series (per-3-minute body battery and stress) are NOT stored. Daily
 * aggregates carry the analytical value at a fraction of the size.
 */
export async function ensureWellnessSchema(client: PoolClient): Promise<void> {
  const cols: [string, string][] = [
    // Body Battery — Garmin gives daily charged/drained plus a sampled series;
    // we keep the four daily scalars only.
    ['body_battery_high',       'SMALLINT'],
    ['body_battery_low',        'SMALLINT'],
    ['body_battery_charged',    'SMALLINT'],
    ['body_battery_drained',    'SMALLINT'],
    // Training Readiness — Garmin's own composite. Better than the local
    // HRV/sleep/RHR blend, which stays as the fallback for pre-Garmin history.
    ['training_readiness',      'SMALLINT'],
    ['training_readiness_level','TEXT'],
    ['recovery_time_mins',      'INT'],
    // Training Status + acute/chronic load. Directly comparable to the app's
    // own CTL/ATL/TSB, computed by Garmin from the same rides.
    ['training_status',         'TEXT'],
    ['training_status_sport',   'TEXT'],
    ['acute_load',              'INT'],
    ['chronic_load',            'INT'],
    ['acwr',                    'FLOAT'],
    // Garmin reports a cycling-specific VO2max alongside the generic one.
    ['vo2max',                  'FLOAT'],
    ['vo2max_cycling',          'FLOAT'],
    ['hrv_status',              'TEXT'],
    ['hrv_weekly_avg',          'SMALLINT'],
    ['sleep_deep_secs',         'INT'],
    ['sleep_light_secs',        'INT'],
    ['sleep_rem_secs',          'INT'],
    ['sleep_awake_secs',        'INT'],
    ['stress_avg',              'SMALLINT'],
    ['respiration_avg',         'FLOAT'],
    ['spo2_avg',                'SMALLINT'],
  ];
  for (const [name, type] of cols) {
    await client.query(`ALTER TABLE daily_wellness ADD COLUMN IF NOT EXISTS ${name} ${type}`);
  }

  // Raw payloads live apart from the hot table on purpose — see the note above.
  await client.query(`
    CREATE TABLE IF NOT EXISTS daily_wellness_raw (
      date      DATE PRIMARY KEY,
      payload   JSONB,
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}
