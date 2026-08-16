import type { PoolClient } from 'pg';

/**
 * Provider-neutral identity for activities.
 *
 * `activities.id` was originally the raw Strava activity ID, and six tables
 * plus a JSONB array (athlete_profile.data.events[].linked_activity_ids) join
 * on it. Renumbering was never an option, so `id` stays a surrogate that is
 * assigned once and never changes; which provider a row came from is recorded
 * alongside it.
 *
 *   source     'strava' | 'garmin' — who created the row
 *   strava_id  Strava's activity ID, NULL for Garmin-only activities
 *   garmin_id  Garmin's activity ID, NULL for Strava-only activities
 *
 * Both external IDs are populated on a row when the same ride arrives from
 * both providers, which is the normal case.
 */

export type ActivitySource = 'strava' | 'garmin';

/**
 * Offset that maps a Garmin activity ID into the surrogate keyspace.
 *
 * Must satisfy two constraints:
 *   • far above any Strava ID (currently ~2.0e10) so the two never collide;
 *   • OFFSET + garminId stays under Number.MAX_SAFE_INTEGER (9.007e15), or
 *     JavaScript silently rounds the ID and every downstream join breaks.
 *
 * 1e15 leaves ~5 orders of magnitude of headroom above Strava and ~8000x
 * headroom below the float53 ceiling for Garmin IDs (currently ~2.4e10).
 *
 * Deterministic on purpose: re-ingesting the same Garmin activity produces the
 * same surrogate without a lookup, and a restore-from-backup can't mint
 * colliding IDs the way a sequence would.
 */
export const GARMIN_ID_OFFSET = 1_000_000_000_000_000;

export function mintGarminId(garminActivityId: number): number {
  if (!Number.isSafeInteger(garminActivityId) || garminActivityId <= 0) {
    throw new Error(`Invalid Garmin activity id: ${garminActivityId}`);
  }
  const id = GARMIN_ID_OFFSET + garminActivityId;
  if (!Number.isSafeInteger(id)) {
    throw new Error(`Garmin id ${garminActivityId} overflows the surrogate keyspace`);
  }
  return id;
}

export function isGarminMinted(id: number): boolean {
  return id >= GARMIN_ID_OFFSET;
}

/** Idempotent DDL. Safe to call on every request — mirrors ensureDeletionSchema. */
export async function ensureIdentitySchema(client: PoolClient): Promise<void> {
  await client.query(`ALTER TABLE activities ADD COLUMN IF NOT EXISTS source    TEXT`);
  await client.query(`ALTER TABLE activities ADD COLUMN IF NOT EXISTS strava_id BIGINT`);
  await client.query(`ALTER TABLE activities ADD COLUMN IF NOT EXISTS garmin_id BIGINT`);

  // Every pre-existing row was keyed by its Strava ID, by definition.
  await client.query(`
    UPDATE activities
       SET strava_id = id, source = 'strava'
     WHERE strava_id IS NULL AND id < ${GARMIN_ID_OFFSET}
  `);

  // Partial unique indexes are the structural guard against the failure that
  // is expensive to detect late: two rows for one ride double-count TSS, which
  // silently skews CTL/ATL/TSB and the coaching model.
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS activities_strava_id_uq
      ON activities(strava_id) WHERE strava_id IS NOT NULL
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS activities_garmin_id_uq
      ON activities(garmin_id) WHERE garmin_id IS NOT NULL
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS activities_start_date_idx ON activities(start_date)
  `);

  // Tombstones must be findable by external ID too: a ride deleted while it
  // was Strava-keyed would otherwise be re-minted under a Garmin surrogate and
  // come back from the dead.
  await client.query(`ALTER TABLE deleted_activities ADD COLUMN IF NOT EXISTS strava_id BIGINT`);
  await client.query(`ALTER TABLE deleted_activities ADD COLUMN IF NOT EXISTS garmin_id BIGINT`);
  await client.query(`
    UPDATE deleted_activities
       SET strava_id = id
     WHERE strava_id IS NULL AND id < ${GARMIN_ID_OFFSET}
  `);
}

/**
 * The Strava ID to use when calling Strava's API for a given internal id.
 * NULL means this activity has no Strava counterpart — callers must skip
 * rather than pass the internal id through, or a Garmin-only ride would 404
 * against Strava on every backfill tick.
 */
export async function stravaIdFor(
  client: PoolClient,
  activityId: number
): Promise<number | null> {
  const res = await client.query<{ strava_id: string | null }>(
    `SELECT strava_id FROM activities WHERE id = $1`,
    [activityId]
  );
  if (res.rowCount === 0) {
    // Row not created yet (first sync of a brand-new Strava activity): the
    // internal id and the Strava id are the same thing at that point.
    return activityId < GARMIN_ID_OFFSET ? activityId : null;
  }
  const raw = res.rows[0].strava_id;
  if (raw !== null) return Number(raw);
  // Column not backfilled yet — legacy rows are Strava-keyed by definition.
  return activityId < GARMIN_ID_OFFSET ? activityId : null;
}

/** Tolerances for matching the same ride arriving from two providers. */
export const MATCH_WINDOW_SECONDS = 120;

export interface IncomingActivity {
  source:      ActivitySource;
  externalId:  number;
  /** UTC. Garmin returns local time separately — convert before calling. */
  startDate:   Date;
  elapsedTime: number | null;
  distance?:   number | null;
}

export interface ResolvedActivity {
  id:      number;
  isNew:   boolean;
  /** True when this linked an existing row from the other provider. */
  merged:  boolean;
}

/**
 * Find (or allocate) the internal id for an incoming activity.
 *
 * ±120s rather than the ±60s used by lib/power-meter-sync.ts: Strava's
 * start_date for a Garmin upload drifts by however many seconds the device
 * spent acquiring GPS. Duration is a second gate; distance only ever breaks a
 * tie, because Strava's auto-pause trimming disagrees with the FIT by 1–3%.
 *
 * If two candidates survive both gates and distance can't separate them
 * (back-to-back trainer efforts), this refuses to merge and returns a new row
 * instead. A duplicate row is visible and fixable; silently welding two
 * different rides together is not.
 */
export async function resolveActivityId(
  client: PoolClient,
  incoming: IncomingActivity
): Promise<ResolvedActivity> {
  const col = incoming.source === 'strava' ? 'strava_id' : 'garmin_id';

  const exact = await client.query<{ id: string }>(
    `SELECT id FROM activities WHERE ${col} = $1`,
    [incoming.externalId]
  );
  if (exact.rowCount) return { id: Number(exact.rows[0].id), isNew: false, merged: false };

  const candidates = await client.query<{
    id: string; elapsed_time: number | null; distance: number | null;
  }>(
    `SELECT id, elapsed_time, distance
       FROM activities
      WHERE ABS(EXTRACT(EPOCH FROM (start_date - $1::timestamptz))) <= $2
        AND ${col} IS NULL
      ORDER BY start_date`,
    [incoming.startDate.toISOString(), MATCH_WINDOW_SECONDS]
  );

  const viable = candidates.rows.filter(r => {
    if (incoming.elapsedTime == null || r.elapsed_time == null) return true;
    const tolerance = Math.max(MATCH_WINDOW_SECONDS, r.elapsed_time * 0.05);
    return Math.abs(r.elapsed_time - incoming.elapsedTime) <= tolerance;
  });

  let chosen = viable[0];
  if (viable.length > 1) {
    if (incoming.distance == null) {
      console.warn(
        `[identity] ${viable.length} candidates for ${incoming.source} ${incoming.externalId} ` +
        `at ${incoming.startDate.toISOString()} and no distance to break the tie — creating a new row`
      );
      chosen = undefined as unknown as typeof chosen;
    } else {
      const scored = viable
        .filter(r => r.distance != null)
        .map(r => ({ r, delta: Math.abs(Number(r.distance) - incoming.distance!) }))
        .sort((a, b) => a.delta - b.delta);
      if (scored.length < 2 || scored[1].delta - scored[0].delta > 100) {
        chosen = scored[0]?.r ?? viable[0];
      } else {
        console.warn(
          `[identity] ambiguous match for ${incoming.source} ${incoming.externalId} ` +
          `at ${incoming.startDate.toISOString()} — refusing to merge, creating a new row`
        );
        chosen = undefined as unknown as typeof chosen;
      }
    }
  }

  if (chosen) {
    const id = Number(chosen.id);
    await client.query(`UPDATE activities SET ${col} = $1 WHERE id = $2`, [incoming.externalId, id]);
    return { id, isNew: false, merged: true };
  }

  const id = incoming.source === 'strava'
    ? incoming.externalId
    : mintGarminId(incoming.externalId);
  return { id, isNew: true, merged: false };
}

/**
 * Has this activity been deleted in the app?
 *
 * Checks the internal id, both external ids, and a start-time window — the
 * window covers tombstones written before the external-id columns existed,
 * which is all of them today.
 */
export async function isTombstoned(
  client: PoolClient,
  probe: { id?: number | null; stravaId?: number | null; garminId?: number | null; startDate?: Date | null }
): Promise<boolean> {
  try {
    const res = await client.query(
      `SELECT 1 FROM deleted_activities
        WHERE ($1::bigint IS NOT NULL AND id        = $1)
           OR ($2::bigint IS NOT NULL AND strava_id = $2)
           OR ($3::bigint IS NOT NULL AND garmin_id = $3)
           OR ($4::timestamptz IS NOT NULL
               AND start_date IS NOT NULL
               AND ABS(EXTRACT(EPOCH FROM (start_date - $4::timestamptz))) <= $5)
        LIMIT 1`,
      [
        probe.id ?? null,
        probe.stravaId ?? null,
        probe.garminId ?? null,
        probe.startDate?.toISOString() ?? null,
        MATCH_WINDOW_SECONDS,
      ]
    );
    return (res.rowCount ?? 0) > 0;
  } catch {
    // Tombstone table/columns not created yet — nothing has been deleted.
    return false;
  }
}
