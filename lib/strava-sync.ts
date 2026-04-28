import pool from './db';
import { getProfile, effectiveFtp } from './profile';

const CLIENT_ID     = process.env.STRAVA_CLIENT_ID!;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET!;
const REFRESH_TOKEN = process.env.STRAVA_REFRESH_TOKEN!;

// Cache the access token for the lifetime of this lambda instance.
// Strava access tokens are valid for 6 hours — plenty. Re-fetching on every
// syncActivity() call was adding ~200-500 ms per activity and creating
// pointless OAuth traffic.
let _tokenCache: { token: string; expiresAt: number } | null = null;

export async function getStravaToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_tokenCache && _tokenCache.expiresAt - 60 > now) {
    return _tokenCache.token;
  }
  const r = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Strava token refresh failed: HTTP ${r.status} ${body.slice(0, 200)}`);
  }
  const d = await r.json() as { access_token: string; expires_at: number };
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

    // Ensure hr column exists (idempotent)
    await client.query(`
      ALTER TABLE activity_streams ADD COLUMN IF NOT EXISTS hr INT[]
    `).catch(() => {});

    // Fetch power+HR streams + laps in parallel
    const [streamRes, lapsRes] = await Promise.all([
      fetch(`https://www.strava.com/api/v3/activities/${activityId}/streams?keys=watts,heartrate&key_by_type=true`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`https://www.strava.com/api/v3/activities/${activityId}/laps`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);

    const streamData  = streamRes.ok ? await streamRes.json() as Record<string, unknown> : null;
    const powerStream = (streamData?.watts     as { data: number[] } | null)?.data ?? null;
    const hrStream    = (streamData?.heartrate as { data: number[] } | null)?.data ?? null;

    // Store streams
    if (powerStream || hrStream) {
      await client.query(`
        INSERT INTO activity_streams (activity_id, watts, hr)
        VALUES ($1, $2, $3)
        ON CONFLICT (activity_id) DO UPDATE
          SET watts = COALESCE(EXCLUDED.watts, activity_streams.watts),
              hr    = COALESCE(EXCLUDED.hr,    activity_streams.hr)
      `, [activityId, powerStream, hrStream]);
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
