import pool from '@/lib/db';
import { getStravaToken, ensureSegmentTables } from '@/lib/strava-sync';
import type { PoolClient } from 'pg';

export const runtime = 'nodejs';
export const maxDuration = 60;

function windDegToCompass(deg: number): string {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

async function fetchWindForEfforts(
  lat: number,
  lng: number,
  efforts: Array<{ id: number; start_date: string; wind_speed: number | null }>
): Promise<Map<number, { speed: number; direction: number }>> {
  const cutoff  = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const missing = efforts.filter(e => e.wind_speed === null && e.start_date?.slice(0, 10) <= cutoff);
  if (missing.length === 0) return new Map();

  const dates   = missing.map(e => e.start_date.slice(0, 10));
  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));

  try {
    const url = new URL('https://archive-api.open-meteo.com/v1/archive');
    url.searchParams.set('latitude',        String(lat));
    url.searchParams.set('longitude',       String(lng));
    url.searchParams.set('start_date',      minDate);
    url.searchParams.set('end_date',        maxDate);
    url.searchParams.set('hourly',          'wind_speed_10m,wind_direction_10m');
    url.searchParams.set('wind_speed_unit', 'kmh');
    url.searchParams.set('timezone',        'UTC');

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return new Map();

    const data = await res.json() as {
      hourly: { time: string[]; wind_speed_10m: number[]; wind_direction_10m: number[] };
    };

    const result = new Map<number, { speed: number; direction: number }>();
    for (const effort of missing) {
      const effortMs = new Date(effort.start_date).getTime();
      let bestIdx = 0, bestDiff = Infinity;
      data.hourly.time.forEach((t, i) => {
        const ts   = t.length === 16 ? t + ':00Z' : t;
        const diff = Math.abs(new Date(ts).getTime() - effortMs);
        if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
      });
      const speed     = data.hourly.wind_speed_10m[bestIdx];
      const direction = data.hourly.wind_direction_10m[bestIdx];
      if (speed != null && direction != null) {
        result.set(effort.id, { speed: Math.round(speed * 10) / 10, direction });
      }
    }
    return result;
  } catch {
    return new Map();
  }
}

async function syncAllEffortsFromStrava(
  segmentId: string,
  client: PoolClient
): Promise<{ count: number; error?: string }> {
  const token = await getStravaToken();
  const all: Record<string, unknown>[] = [];
  let gotOk = false;

  for (let page = 1; page <= 10; page++) {
    const res = await fetch(
      `https://www.strava.com/api/v3/segments/${segmentId}/all_efforts?per_page=200&page=${page}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[segments/efforts] Strava all_efforts failed: ${res.status} ${body}`);
      return { count: 0, error: `Strava ${res.status}: ${body.slice(0, 200)}` };
    }

    gotOk = true;
    const batch = await res.json() as Record<string, unknown>[];
    all.push(...batch);
    if (batch.length < 200) break;
  }

  for (const se of all) {
    const activityId = (se.activity as Record<string, unknown> | null)?.id ?? se.activity_id;
    await client.query(`
      INSERT INTO segment_efforts
        (id, activity_id, segment_id, name, elapsed_time, moving_time,
         start_date, distance, average_watts, average_heartrate, max_heartrate, pr_rank, kom_rank)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (id) DO UPDATE SET
        pr_rank       = EXCLUDED.pr_rank,
        kom_rank      = EXCLUDED.kom_rank,
        max_heartrate = EXCLUDED.max_heartrate
    `, [
      se.id, activityId, segmentId,
      se.name,
      se.elapsed_time, se.moving_time,
      se.start_date, se.distance,
      (se.average_watts     as number | null) ?? null,
      (se.average_heartrate as number | null) ?? null,
      (se.max_heartrate     as number | null) ?? null,
      (se.pr_rank           as number | null) ?? null,
      (se.kom_rank          as number | null) ?? null,
    ]);
  }

  // Only mark synced if Strava responded OK (even if 0 results means legitimately no efforts)
  if (gotOk) {
    await client.query(
      `UPDATE starred_segments SET all_efforts_synced_at = NOW() WHERE id = $1`,
      [segmentId]
    );
  }

  return { count: all.length };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const force   = new URL(req.url).searchParams.has('force');

  await ensureSegmentTables();
  const client = await pool.connect();

  try {
    const syncRes = await client.query(
      `SELECT all_efforts_synced_at FROM starred_segments WHERE id = $1`, [id]
    );
    const lastSync = syncRes.rows[0]?.all_efforts_synced_at as Date | null;
    const stale    = force || !lastSync || (Date.now() - new Date(lastSync).getTime() > 24 * 60 * 60 * 1000);

    let syncError: string | undefined;
    if (stale) {
      const result = await syncAllEffortsFromStrava(id, client).catch(err => {
        console.error('[segments/efforts] sync threw:', err);
        return { count: 0, error: String(err) };
      });
      syncError = result.error;
      // If sync errored, clear the timestamp so next load retries automatically
      if (result.error) {
        await client.query(
          `UPDATE starred_segments SET all_efforts_synced_at = NULL WHERE id = $1`, [id]
        ).catch(() => {});
      }
    }

    // Always return whatever is in DB
    const effortsRes = await client.query(`
      SELECT
        se.id, se.activity_id, se.elapsed_time,
        se.start_date, se.average_watts, se.average_heartrate, se.max_heartrate,
        se.pr_rank, se.kom_rank, se.wind_speed, se.wind_direction,
        a.name AS activity_name
      FROM segment_efforts se
      LEFT JOIN activities a ON a.id = se.activity_id
      WHERE se.segment_id = $1
      ORDER BY se.start_date DESC
    `, [id]);

    const efforts = effortsRes.rows;

    // Fetch wind for efforts missing it
    const segRes = await client.query(
      `SELECT start_lat, start_lng FROM starred_segments WHERE id = $1`, [id]
    );
    const seg = segRes.rows[0];

    if (seg?.start_lat && seg?.start_lng && efforts.some((e: { wind_speed: number | null }) => e.wind_speed === null)) {
      const windMap = await fetchWindForEfforts(seg.start_lat, seg.start_lng, efforts);
      for (const effort of efforts) {
        const wind = windMap.get(effort.id);
        if (wind) {
          effort.wind_speed     = wind.speed;
          effort.wind_direction = wind.direction;
          await client.query(
            `UPDATE segment_efforts SET wind_speed=$1, wind_direction=$2 WHERE id=$3`,
            [wind.speed, wind.direction, effort.id]
          );
        }
      }
    }

    for (const e of efforts) {
      if (e.wind_direction != null) e.wind_compass = windDegToCompass(e.wind_direction);
    }

    return Response.json({ efforts, syncError });
  } finally {
    client.release();
  }
}
