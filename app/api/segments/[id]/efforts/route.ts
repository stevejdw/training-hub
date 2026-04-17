import pool from '@/lib/db';
import { ensureSegmentTables } from '@/lib/strava-sync';

export const runtime = 'nodejs';

function windDegToCompass(deg: number): string {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

async function fetchWindForEfforts(
  lat: number,
  lng: number,
  efforts: Array<{ id: number; start_date: string; wind_speed: number | null }>
): Promise<Map<number, { speed: number; direction: number }>> {
  const missing = efforts.filter(e => e.wind_speed === null && e.start_date);
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

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return new Map();

    const data = await res.json() as {
      hourly: { time: string[]; wind_speed_10m: number[]; wind_direction_10m: number[] };
    };

    const result = new Map<number, { speed: number; direction: number }>();
    for (const effort of missing) {
      const effortMs = new Date(effort.start_date).getTime();
      let bestIdx  = 0;
      let bestDiff = Infinity;
      data.hourly.time.forEach((t, i) => {
        const diff = Math.abs(new Date(t.includes('T') ? t + ':00Z' : t + 'T00:00Z').getTime() - effortMs);
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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await ensureSegmentTables();
  const client = await pool.connect();

  try {
    const effortsRes = await client.query(`
      SELECT
        se.id, se.activity_id, se.elapsed_time, se.moving_time,
        se.start_date, se.distance, se.average_watts, se.average_heartrate, se.max_heartrate,
        se.pr_rank, se.kom_rank, se.wind_speed, se.wind_direction,
        a.name AS activity_name
      FROM segment_efforts se
      LEFT JOIN activities a ON a.id = se.activity_id
      WHERE se.segment_id = $1
      ORDER BY se.start_date DESC
    `, [id]);

    const efforts = effortsRes.rows;

    // Fetch wind for efforts that are missing it
    const segRes = await client.query(
      `SELECT start_lat, start_lng FROM starred_segments WHERE id = $1`, [id]
    );
    const seg = segRes.rows[0];

    if (seg?.start_lat && seg?.start_lng) {
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

    // Add compass label
    for (const e of efforts) {
      if (e.wind_direction != null) {
        e.wind_compass = windDegToCompass(e.wind_direction);
      }
    }

    return Response.json({ efforts });
  } finally {
    client.release();
  }
}
