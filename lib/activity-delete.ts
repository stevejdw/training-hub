import type { PoolClient } from 'pg';
import pool from './db';
import { getProfile, effectiveLthr } from './profile';

/**
 * Deleting data from within the app has to survive the next Strava sync,
 * otherwise the webhook / backfill would just put it straight back.  Two bits
 * of bookkeeping make deletions sticky:
 *
 *   • `deleted_activities` — tombstones, so a deleted activity is never
 *     re-imported by syncActivity / syncRecentActivities / syncHistoricalBatch.
 *   • `activities.power_deleted` / `.hr_deleted` — per-activity flags, so a
 *     re-sync writes NULL for those channels instead of Strava's values.
 */

export type DeleteScope = 'activity' | 'power' | 'hr';

export function parseScope(raw: string | null): DeleteScope | null {
  if (raw === null || raw === '' || raw === 'activity') return 'activity';
  if (raw === 'power' || raw === 'hr') return raw;
  return null;
}

/** Idempotent DDL for the deletion bookkeeping. Safe to call on every request. */
export async function ensureDeletionSchema(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS deleted_activities (
      id         BIGINT PRIMARY KEY,
      name       TEXT,
      start_date TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await client.query(`ALTER TABLE activities ADD COLUMN IF NOT EXISTS power_deleted BOOLEAN NOT NULL DEFAULT FALSE`);
  await client.query(`ALTER TABLE activities ADD COLUMN IF NOT EXISTS hr_deleted    BOOLEAN NOT NULL DEFAULT FALSE`);
}

/** HRSS = hours × 100 × (avg_hr / LTHR)² — mirrors calculateHrss in strava-sync. */
function hrss(movingTime: number, avgHr: number, lthr: number): number | null {
  if (!movingTime || !avgHr || avgHr <= 0) return null;
  return Math.round((movingTime / 3600) * 100 * (avgHr / lthr) * (avgHr / lthr));
}

/** Which channels a given activity has had deleted. Used by the sync path. */
export async function getDeletionFlags(
  client: PoolClient,
  activityId: number
): Promise<{ tombstoned: boolean; powerDeleted: boolean; hrDeleted: boolean }> {
  try {
    const [tomb, flags] = await Promise.all([
      client.query(`SELECT 1 FROM deleted_activities WHERE id = $1`, [activityId]),
      client.query<{ power_deleted: boolean; hr_deleted: boolean }>(
        `SELECT power_deleted, hr_deleted FROM activities WHERE id = $1`,
        [activityId]
      ),
    ]);
    return {
      tombstoned:   (tomb.rowCount ?? 0) > 0,
      powerDeleted: flags.rows[0]?.power_deleted ?? false,
      hrDeleted:    flags.rows[0]?.hr_deleted ?? false,
    };
  } catch {
    // Bookkeeping columns/table not created yet — nothing has been deleted.
    return { tombstoned: false, powerDeleted: false, hrDeleted: false };
  }
}

/** IDs from `candidates` that have been deleted and must not be re-imported. */
export async function filterTombstoned(
  client: PoolClient,
  candidates: number[]
): Promise<Set<number>> {
  if (candidates.length === 0) return new Set();
  try {
    const res = await client.query<{ id: string }>(
      `SELECT id FROM deleted_activities WHERE id = ANY($1::bigint[])`,
      [candidates]
    );
    return new Set(res.rows.map(r => Number(r.id)));
  } catch {
    return new Set();
  }
}

/** Permanently remove an activity and every row derived from it. */
export async function deleteActivity(activityId: number): Promise<boolean> {
  const client = await pool.connect();
  try {
    await ensureDeletionSchema(client);
    await client.query('BEGIN');

    const existing = await client.query<{ name: string; start_date: string }>(
      `SELECT name, start_date FROM activities WHERE id = $1`,
      [activityId]
    );
    if (existing.rowCount === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    await client.query(`DELETE FROM activity_streams    WHERE activity_id = $1`, [activityId]);
    await client.query(`DELETE FROM best_power_efforts  WHERE activity_id = $1`, [activityId]);
    await client.query(`DELETE FROM segment_efforts     WHERE activity_id = $1`, [activityId]);
    await client.query(`DELETE FROM laps                WHERE activity_id = $1`, [activityId]);
    await client.query(`DELETE FROM activities          WHERE id = $1`,          [activityId]);

    await client.query(
      `INSERT INTO deleted_activities (id, name, start_date)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET deleted_at = NOW()`,
      [activityId, existing.rows[0].name, existing.rows[0].start_date]
    );

    // The cached coaching summary may reference the activity we just removed.
    await client.query(`DELETE FROM coaching_cache WHERE last_activity_id = $1`, [activityId]).catch(() => {});

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Strip power from an activity: summary fields, the watts stream, best-power
 * efforts and lap/segment power.  TSS falls back to HR-based HRSS if the
 * activity still has heart rate, otherwise it is cleared.
 */
export async function deletePowerData(activityId: number): Promise<boolean> {
  const profile = await getProfile();
  const lthr    = effectiveLthr(profile) ?? 173;

  const client = await pool.connect();
  try {
    await ensureDeletionSchema(client);
    await client.query('BEGIN');

    const existing = await client.query<{ moving_time: number; average_heartrate: number | null; hr_deleted: boolean }>(
      `SELECT moving_time, average_heartrate, hr_deleted FROM activities WHERE id = $1`,
      [activityId]
    );
    if (existing.rowCount === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    const row     = existing.rows[0];
    const avgHr   = row.hr_deleted ? null : row.average_heartrate;
    const newHrss = avgHr ? hrss(row.moving_time, avgHr, lthr) : null;

    await client.query(
      `UPDATE activities SET
         average_watts          = NULL,
         weighted_average_watts = NULL,
         max_watts              = NULL,
         normalized_power       = NULL,
         intensity_factor       = NULL,
         kilojoules             = NULL,
         power_meter            = NULL,
         power_meter_serial     = NULL,
         hrss                   = $2::int,
         tss                    = $2::float,
         power_deleted          = TRUE,
         updated_at             = NOW()
       WHERE id = $1`,
      [activityId, newHrss]
    );

    await client.query(`DELETE FROM best_power_efforts WHERE activity_id = $1`, [activityId]);
    await client.query(`UPDATE activity_streams SET watts = NULL WHERE activity_id = $1`, [activityId]);
    await client.query(
      `UPDATE laps SET average_watts = NULL, normalized_power = NULL WHERE activity_id = $1`,
      [activityId]
    );
    await client.query(
      `UPDATE segment_efforts SET average_watts = NULL WHERE activity_id = $1`,
      [activityId]
    );

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Strip heart rate from an activity: summary fields, the hr stream and
 * lap/segment HR.  A power-based TSS is left untouched; an HR-derived one is
 * cleared along with the data it came from.
 */
export async function deleteHeartRateData(activityId: number): Promise<boolean> {
  const client = await pool.connect();
  try {
    await ensureDeletionSchema(client);
    await client.query('BEGIN');

    const existing = await client.query<{ normalized_power: number | null; power_deleted: boolean }>(
      `SELECT normalized_power, power_deleted FROM activities WHERE id = $1`,
      [activityId]
    );
    if (existing.rowCount === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    // TSS came from power if power is still present; otherwise it was HRSS.
    const row          = existing.rows[0];
    const keepPowerTss = !row.power_deleted && row.normalized_power != null;

    await client.query(
      `UPDATE activities SET
         average_heartrate = NULL,
         max_heartrate     = NULL,
         suffer_score      = NULL,
         hrss              = NULL,
         tss               = CASE WHEN $2::boolean THEN tss ELSE NULL END,
         hr_deleted        = TRUE,
         updated_at        = NOW()
       WHERE id = $1`,
      [activityId, keepPowerTss]
    );

    await client.query(`UPDATE activity_streams SET hr = NULL WHERE activity_id = $1`, [activityId]);
    await client.query(
      `UPDATE laps SET average_heartrate = NULL, max_heartrate = NULL WHERE activity_id = $1`,
      [activityId]
    );
    await client.query(
      `UPDATE segment_efforts SET average_heartrate = NULL, max_heartrate = NULL WHERE activity_id = $1`,
      [activityId]
    );

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
