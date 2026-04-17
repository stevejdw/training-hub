import pool from './db';
import { getProfile, effectiveFtp } from './profile';

const CLIENT_ID     = process.env.STRAVA_CLIENT_ID!;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET!;
const REFRESH_TOKEN = process.env.STRAVA_REFRESH_TOKEN!;

export async function getStravaToken(): Promise<string> {
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
  const d = await r.json() as { access_token: string };
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

  const client = await pool.connect();
  try {
    // Upsert activity
    await client.query(`
      INSERT INTO activities (
        id, name, sport_type, start_date, elapsed_time,
        moving_time, distance, total_elevation_gain,
        average_watts, weighted_average_watts, max_watts,
        kilojoules, average_heartrate, max_heartrate,
        suffer_score, trainer, average_speed,
        tss, intensity_factor, normalized_power, summary_polyline
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
      )
      ON CONFLICT (id) DO UPDATE SET
        name             = EXCLUDED.name,
        tss              = EXCLUDED.tss,
        intensity_factor = EXCLUDED.intensity_factor,
        normalized_power = EXCLUDED.normalized_power,
        summary_polyline = EXCLUDED.summary_polyline,
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
  } finally {
    client.release();
  }
}
