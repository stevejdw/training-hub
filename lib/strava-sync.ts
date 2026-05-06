import pool from './db';
import { getProfile, effectiveFtp } from './profile';

const CLIENT_ID     = process.env.STRAVA_CLIENT_ID!;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET!;
const REFRESH_TOKEN = process.env.STRAVA_REFRESH_TOKEN!;   // fallback only

// In-memory cache for the current access token.
let _tokenCache: { token: string; expiresAt: number } | null = null;

/** Look up the refresh token to use.
 *  Prefers a DB-stored token (written by /api/strava/callback after a
 *  full re-auth with read + read_all + activity:read_all scopes) over the
 *  env-var STRAVA_REFRESH_TOKEN which may have been issued with narrower scopes. */
async function getRefreshToken(): Promise<string> {
  try {
    const client = await pool.connect();
    try {
      const res = await client.query<{ refresh_token: string }>(
        `SELECT refresh_token FROM strava_tokens WHERE id = 1 LIMIT 1`
      );
      if (res.rows[0]?.refresh_token) return res.rows[0].refresh_token;
    } catch {
      // table doesn't exist yet — fall through to env var
    } finally {
      client.release();
    }
  } catch { /* DB not available */ }
  return REFRESH_TOKEN;
}

export async function getStravaToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_tokenCache && _tokenCache.expiresAt - 60 > now) {
    return _tokenCache.token;
  }

  const refreshToken = await getRefreshToken();

  const r = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Strava token refresh failed: HTTP ${r.status} ${body.slice(0, 200)}`);
  }
  const d = await r.json() as { access_token: string; refresh_token: string; expires_at: number };

  // Persist the rotated refresh token back to DB if we're using DB storage
  try {
    const client = await pool.connect();
    try {
      await client.query(`
        UPDATE strava_tokens SET refresh_token = $1, updated_at = NOW() WHERE id = 1
      `, [d.refresh_token]);
    } catch { /* ignore if table doesn't exist */ }
    finally { client.release(); }
  } catch { /* ignore */ }

  _tokenCache = { token: d.access_token, expiresAt: d.expires_at };
  return d.access_token;
}

function calculateNp(watts: (number | null)[]): number | null {
  const clean = watts.map(w => w ?? 0);
  if (clean.length < 30) return null;
  const window = 30;
  const rolling: number[] = [];
  for (let i = 0; i <= clean.length - window; i++) {
    let sum = 0;
    for (let j = i; j < i + window; j++) sum += clean[j];
    rolling.push(sum / window);
  }
  const avg4 = rolling.reduce((s, v) => s + v ** 4, 0) / rolling.length;
  return Math.round(avg4 ** 0.25);
}

function calculateTss(movingTime: number, np: number, ftp: number): number | null {
  if (!np || !ftp) return null;
  const IF = np / ftp;
  return Math.round((movingTime * np * IF) / (ftp * 3600) * 100 * 10) / 10;
}

/**
 * Fetch a page of historical activities from Strava (before the oldest stored
 * activity, or before a supplied epoch) and bulk-insert the summary data.
 *
 * Strategy: use the fast list endpoint (100 activities per call, one round-trip
 * to Strava + one bulk upsert) so a single Vercel invocation can cover ~100
 * activities.  Streams / laps / segment efforts are left for the existing
 * segment-backfill mechanism (segments_synced_at = NULL flags them for pickup).
 *
 * @param beforeEpoch  Unix epoch to pass as `before=` param.  If omitted the
 *                     oldest start_date already in the DB is used.
 * @returns { synced, hasMore, nextBefore } where nextBefore is the epoch of
 *          the oldest activity fetched this batch (use for the next call).
 */
export async function syncHistoricalBatch(beforeEpoch?: number): Promise<{
  synced:      number;
  hasMore:     boolean;
  nextBefore:  number | null;
  oldestDate:  string | null;
}> {
  const token = await getStravaToken();

  // Resolve beforeEpoch from DB if not supplied
  if (!beforeEpoch) {
    const c = await pool.connect();
    try {
      const res = await c.query(
        `SELECT EXTRACT(EPOCH FROM MIN(start_date))::bigint AS epoch FROM activities`
      );
      beforeEpoch = Number(res.rows[0]?.epoch ?? 0) || undefined;
    } finally {
      c.release();
    }
  }

  const qs = new URLSearchParams({ per_page: '100', page: '1' });
  if (beforeEpoch) qs.set('before', String(beforeEpoch));

  const listRes = await fetch(`https://www.strava.com/api/v3/athlete/activities?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) {
    const body = await listRes.text().catch(() => '');
    throw new Error(`Strava activities list failed: ${listRes.status} ${body.slice(0, 200)}`);
  }

  const list = await listRes.json() as Record<string, unknown>[];
  if (list.length === 0) {
    return { synced: 0, hasMore: false, nextBefore: null, oldestDate: null };
  }

  const profile = await getProfile();
  const ftp     = effectiveFtp(profile);

  // Bulk upsert: summary activities already carry most fields we need.
  // We intentionally do NOT fetch individual detail/streams here — that keeps
  // this endpoint well within the 60s Vercel timeout even for 100 activities.
  const client = await pool.connect();
  try {
    for (const a of list) {
      const np      = (a.weighted_average_watts as number | null) ?? null;
      const movingT = a.moving_time as number;
      const tss     = np ? calculateTss(movingT, np, ftp) : null;
      const ifVal   = np ? Math.round((np / ftp) * 1000) / 1000 : null;
      const polyline = (a.map as Record<string, string> | null)?.summary_polyline ?? null;
      const gearId   = (a.gear_id as string | null) ?? null;

      await client.query(`
        INSERT INTO activities (
          id, name, sport_type, start_date, elapsed_time,
          moving_time, distance, total_elevation_gain,
          average_watts, weighted_average_watts, max_watts,
          kilojoules, average_heartrate, max_heartrate,
          suffer_score, trainer, average_speed,
          tss, intensity_factor, normalized_power, summary_polyline,
          gear_id
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
        )
        ON CONFLICT (id) DO NOTHING
      `, [
        a.id, a.name,
        (a.sport_type ?? a.type) as string,
        a.start_date,
        a.elapsed_time, movingT,
        a.distance, a.total_elevation_gain,
        a.average_watts, np, a.max_watts,
        a.kilojoules, a.average_heartrate, a.max_heartrate,
        a.suffer_score, a.trainer ?? false, a.average_speed,
        tss, ifVal, np, polyline,
        gearId,
      ]);
    }
  } finally {
    client.release();
  }

  // The list is newest-first; the last item is the oldest.
  const oldest       = list[list.length - 1];
  const oldestDate   = String(oldest.start_date ?? '');
  const oldestEpoch  = oldest.start_date
    ? Math.floor(new Date(String(oldest.start_date)).getTime() / 1000) - 1
    : null;

  return {
    synced:      list.length,
    hasMore:     list.length === 100,
    nextBefore:  oldestEpoch,
    oldestDate,
  };
}

/** Fetch activities newer than the latest one in the DB and sync each one fully. */
export async function syncRecentActivities(): Promise<{ synced: number; names: string[] }> {
  const token = await getStravaToken();

  // Find epoch of most recent activity stored
  const dbClient = await pool.connect();
  let afterEpoch = 0;
  try {
    const res = await dbClient.query(
      `SELECT EXTRACT(EPOCH FROM MAX(start_date))::bigint AS epoch FROM activities`
    );
    afterEpoch = Number(res.rows[0]?.epoch ?? 0);
  } finally {
    dbClient.release();
  }

  // List activities from Strava since that epoch (max 30)
  const qs = new URLSearchParams({ per_page: '30', page: '1' });
  if (afterEpoch > 0) qs.set('after', String(afterEpoch));

  const listRes = await fetch(`https://www.strava.com/api/v3/athlete/activities?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) throw new Error(`Strava list failed: ${listRes.status}`);

  const list = await listRes.json() as Record<string, unknown>[];
  const names: string[] = [];

  for (const a of list) {
    await syncActivity(Number(a.id));
    names.push(String(a.name));
  }

  return { synced: names.length, names };
}

export async function ensureSegmentTables(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS starred_segments (
        id          BIGINT PRIMARY KEY,
        name        TEXT,
        distance    FLOAT,
        avg_grade   FLOAT,
        city        TEXT,
        country     TEXT,
        synced_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS segment_efforts (
        id                BIGINT PRIMARY KEY,
        activity_id       BIGINT,
        segment_id        BIGINT,
        name              TEXT,
        elapsed_time      INTEGER,
        moving_time       INTEGER,
        start_date        TIMESTAMPTZ,
        distance          FLOAT,
        average_watts     FLOAT,
        average_heartrate FLOAT,
        pr_rank           INTEGER,
        kom_rank          INTEGER
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS segment_efforts_activity ON segment_efforts(activity_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS segment_efforts_segment  ON segment_efforts(segment_id)`);
    // Add columns idempotently (no-op if already present)
    await client.query(`ALTER TABLE starred_segments ADD COLUMN IF NOT EXISTS start_lat            FLOAT`);
    await client.query(`ALTER TABLE starred_segments ADD COLUMN IF NOT EXISTS start_lng            FLOAT`);
    await client.query(`ALTER TABLE starred_segments ADD COLUMN IF NOT EXISTS end_lat              FLOAT`);
    await client.query(`ALTER TABLE starred_segments ADD COLUMN IF NOT EXISTS end_lng              FLOAT`);
    await client.query(`ALTER TABLE starred_segments ADD COLUMN IF NOT EXISTS elevation_high       FLOAT`);
    await client.query(`ALTER TABLE starred_segments ADD COLUMN IF NOT EXISTS elevation_low        FLOAT`);
    await client.query(`ALTER TABLE starred_segments ADD COLUMN IF NOT EXISTS total_elevation_gain FLOAT`);
    await client.query(`ALTER TABLE starred_segments ADD COLUMN IF NOT EXISTS climb_category       INTEGER`);
    await client.query(`ALTER TABLE starred_segments ADD COLUMN IF NOT EXISTS polyline             TEXT`);
    await client.query(`ALTER TABLE starred_segments ADD COLUMN IF NOT EXISTS effort_count         INTEGER`);
    await client.query(`ALTER TABLE starred_segments ADD COLUMN IF NOT EXISTS athlete_count        INTEGER`);
    await client.query(`ALTER TABLE starred_segments ADD COLUMN IF NOT EXISTS altitude_stream      FLOAT[]`);
    await client.query(`ALTER TABLE starred_segments ADD COLUMN IF NOT EXISTS distance_stream      FLOAT[]`);
    await client.query(`ALTER TABLE segment_efforts  ADD COLUMN IF NOT EXISTS max_heartrate              FLOAT`);
    await client.query(`ALTER TABLE segment_efforts  ADD COLUMN IF NOT EXISTS wind_speed                 FLOAT`);
    await client.query(`ALTER TABLE segment_efforts  ADD COLUMN IF NOT EXISTS wind_direction             INTEGER`);
    await client.query(`ALTER TABLE starred_segments ADD COLUMN IF NOT EXISTS all_efforts_synced_at      TIMESTAMPTZ`);
    await client.query(`ALTER TABLE activities       ADD COLUMN IF NOT EXISTS segments_synced_at         TIMESTAMPTZ`);
  } finally {
    client.release();
  }
}

export async function syncActivity(activityId: number): Promise<void> {
  const token   = await getStravaToken();
  const profile = await getProfile();
  const ftp     = effectiveFtp(profile);

  // Fetch activity detail
  const aRes = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!aRes.ok) throw new Error(`Strava activity fetch failed: ${aRes.status}`);
  const a = await aRes.json() as Record<string, unknown>;

  const np       = (a.weighted_average_watts as number | null) ?? null;
  const movingTime = a.moving_time as number;
  const tss      = np ? calculateTss(movingTime, np, ftp) : null;
  const ifVal    = np ? Math.round((np / ftp) * 1000) / 1000 : null;
  const polyline = (a.map as Record<string, string> | null)?.summary_polyline ?? null;

  // Gear (bike) — Strava activity detail includes nested `gear` { id, name, nickname, retired }
  const gear   = a.gear as { id?: string; name?: string; nickname?: string; retired?: boolean } | null;
  const gearId = gear?.id ?? (a.gear_id as string | null) ?? null;

  const client = await pool.connect();
  try {
    // Upsert gear first if present (FK-style soft link via gear_id)
    if (gearId) {
      await client.query(`
        INSERT INTO gear (id, name, nickname, retired, synced_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (id) DO UPDATE SET
          name      = COALESCE(EXCLUDED.name, gear.name),
          nickname  = COALESCE(EXCLUDED.nickname, gear.nickname),
          retired   = COALESCE(EXCLUDED.retired, gear.retired),
          synced_at = NOW()
      `, [gearId, gear?.name ?? null, gear?.nickname ?? null, gear?.retired ?? null]).catch(() => {});
    }

    // Upsert activity
    await client.query(`
      INSERT INTO activities (
        id, name, sport_type, start_date, elapsed_time,
        moving_time, distance, total_elevation_gain,
        average_watts, weighted_average_watts, max_watts,
        kilojoules, average_heartrate, max_heartrate,
        suffer_score, trainer, average_speed,
        tss, intensity_factor, normalized_power, summary_polyline,
        gear_id
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
      )
      ON CONFLICT (id) DO UPDATE SET
        name             = EXCLUDED.name,
        tss              = EXCLUDED.tss,
        intensity_factor = EXCLUDED.intensity_factor,
        normalized_power = EXCLUDED.normalized_power,
        summary_polyline = EXCLUDED.summary_polyline,
        gear_id          = EXCLUDED.gear_id,
        updated_at       = NOW()
    `, [
      a.id, a.name,
      (a.sport_type ?? a.type) as string,
      a.start_date,
      a.elapsed_time, movingTime,
      a.distance, a.total_elevation_gain,
      a.average_watts, np, a.max_watts,
      a.kilojoules, a.average_heartrate, a.max_heartrate,
      a.suffer_score, a.trainer ?? false, a.average_speed,
      tss, ifVal, np, polyline,
      gearId,
    ]);

    // Ensure stream columns exist (idempotent)
    await client.query(`
      ALTER TABLE activity_streams ADD COLUMN IF NOT EXISTS hr          INT[];
      ALTER TABLE activity_streams ADD COLUMN IF NOT EXISTS altitude_m  FLOAT[];
      ALTER TABLE activity_streams ADD COLUMN IF NOT EXISTS distance_km FLOAT[];
      ALTER TABLE activity_streams ADD COLUMN IF NOT EXISTS latlng      FLOAT[][];
      ALTER TABLE activity_streams ADD COLUMN IF NOT EXISTS time_s      INT[];
    `).catch(() => {});

    const STREAM_MAX_POINTS = 5000;

    // Fetch power+HR+altitude+distance+latlng+time streams + laps in parallel
    const [streamRes, lapsRes] = await Promise.all([
      fetch(`https://www.strava.com/api/v3/activities/${activityId}/streams?keys=watts,heartrate,altitude,distance,latlng,time&key_by_type=true`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`https://www.strava.com/api/v3/activities/${activityId}/laps`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);

    const streamData  = streamRes.ok ? await streamRes.json() as Record<string, unknown> : null;
    const powerStream = (streamData?.watts     as { data: number[] } | null)?.data ?? null;
    const hrStream    = (streamData?.heartrate as { data: number[] } | null)?.data ?? null;
    const altRaw      = (streamData?.altitude  as { data: number[] } | null)?.data ?? null;
    const distRaw     = (streamData?.distance  as { data: number[] } | null)?.data ?? null;
    const latlngRaw   = (streamData?.latlng    as { data: number[][] } | null)?.data ?? null;
    const timeRaw     = (streamData?.time      as { data: number[] } | null)?.data ?? null;

    // Downsample altitude, distance, latlng, time for storage efficiency
    function downsampleArr<T>(arr: T[], maxPts: number): T[] {
      if (arr.length <= maxPts) return arr;
      const step = arr.length / maxPts;
      return Array.from({ length: maxPts }, (_, i) => arr[Math.round(i * step)]);
    }
    const altStream    = altRaw    ? downsampleArr(altRaw,    STREAM_MAX_POINTS).map(a => Math.round(a * 10) / 10) : null;
    const distStream   = distRaw   ? downsampleArr(distRaw,   STREAM_MAX_POINTS).map(d => Math.round(d / 10) / 100) : null; // m → km
    const timeStream   = timeRaw   ? downsampleArr(timeRaw,   STREAM_MAX_POINTS).map(t => Math.round(t)) : null;
    const latlngStream = latlngRaw
      ? downsampleArr(latlngRaw, STREAM_MAX_POINTS).map(pair => [
          Math.round(Number(pair[0]) * 1e6) / 1e6,
          Math.round(Number(pair[1]) * 1e6) / 1e6,
        ])
      : null;

    // Store streams
    if (powerStream || hrStream || altStream || distStream || latlngStream || timeStream) {
      await client.query(`
        INSERT INTO activity_streams (activity_id, watts, hr, altitude_m, distance_km, latlng, time_s)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (activity_id) DO UPDATE
          SET watts       = COALESCE(EXCLUDED.watts,       activity_streams.watts),
              hr          = COALESCE(EXCLUDED.hr,          activity_streams.hr),
              altitude_m  = COALESCE(EXCLUDED.altitude_m,  activity_streams.altitude_m),
              distance_km = COALESCE(EXCLUDED.distance_km, activity_streams.distance_km),
              latlng      = COALESCE(EXCLUDED.latlng,      activity_streams.latlng),
              time_s      = COALESCE(EXCLUDED.time_s,      activity_streams.time_s)
      `, [activityId, powerStream, hrStream, altStream, distStream, latlngStream, timeStream]);
    }

    // Store laps
    if (lapsRes.ok) {
      const laps = await lapsRes.json() as Record<string, unknown>[];
      for (const lap of laps) {
        const startIdx = lap.start_index as number | null;
        const endIdx   = lap.end_index   as number | null;
        const lapNp    = powerStream && startIdx != null && endIdx != null
          ? calculateNp(powerStream.slice(startIdx, endIdx + 1))
          : null;
        await client.query(`
          INSERT INTO laps (
            id, activity_id, name, lap_index,
            elapsed_time, moving_time, distance,
            average_watts, normalized_power,
            average_heartrate, max_heartrate,
            average_speed, total_elevation_gain,
            start_index, end_index
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
          ON CONFLICT (id) DO NOTHING
        `, [
          lap.id, activityId,
          lap.name, lap.lap_index,
          lap.elapsed_time, lap.moving_time, lap.distance,
          lap.average_watts, lapNp,
          lap.average_heartrate, lap.max_heartrate,
          lap.average_speed, lap.total_elevation_gain,
          startIdx, endIdx,
        ]);
      }
    }

    // Store segment efforts (from the activity detail response)
    const segEfforts = (a.segment_efforts as Record<string, unknown>[] | null) ?? [];
    for (const se of segEfforts) {
      const seg = se.segment as Record<string, unknown> | null;
      if (!seg?.id) continue;
      await client.query(`
        INSERT INTO segment_efforts
          (id, activity_id, segment_id, name, elapsed_time, moving_time,
           start_date, distance, average_watts, average_heartrate, max_heartrate, pr_rank, kom_rank)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (id) DO UPDATE SET
          segment_id    = EXCLUDED.segment_id,
          pr_rank       = EXCLUDED.pr_rank,
          kom_rank      = EXCLUDED.kom_rank,
          max_heartrate = EXCLUDED.max_heartrate
      `, [
        se.id, activityId,
        seg.id,
        se.name ?? seg.name,
        se.elapsed_time, se.moving_time,
        se.start_date,
        se.distance,
        (se.average_watts as number | null) ?? null,
        (se.average_heartrate as number | null) ?? null,
        (se.max_heartrate as number | null) ?? null,
        (se.pr_rank as number | null) ?? null,
        (se.kom_rank as number | null) ?? null,
      ]);
    }
    // Mark activity as having segment efforts stored (even if 0 — avoids re-fetching)
    await client.query(
      `UPDATE activities SET segments_synced_at = NOW() WHERE id = $1`, [activityId]
    ).catch(() => {});
  } finally {
    client.release();
  }
}
