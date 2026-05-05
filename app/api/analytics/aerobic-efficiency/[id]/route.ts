import pool from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 15;

/** Thin downsampler — evenly pick `maxPts` indices from array. */
function downsample<T>(arr: T[], maxPts: number): T[] {
  if (arr.length <= maxPts) return arr;
  const step = (arr.length - 1) / (maxPts - 1);
  return Array.from({ length: maxPts }, (_, i) => arr[Math.round(i * step)]);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const actId = Number(id);
  if (!Number.isFinite(actId)) {
    return Response.json({ error: 'Invalid activity id' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const res = await client.query<{
      name: string;
      start_date: string;
      moving_time: number;
      average_watts: number;
      average_heartrate: number;
      normalized_power: number;
      watts: (number | null)[];
      hr: (number | null)[];
    }>(`
      SELECT
        a.name,
        a.start_date::date::text AS start_date,
        a.moving_time,
        a.average_watts,
        a.average_heartrate,
        a.normalized_power,
        s.watts,
        s.hr
      FROM activities a
      JOIN activity_streams s ON s.activity_id = a.id
      WHERE a.id = $1
        AND s.watts IS NOT NULL
        AND s.hr IS NOT NULL
    `, [actId]);

    if (res.rows.length === 0) {
      return Response.json({ error: 'Activity not found or missing streams' }, { status: 404 });
    }

    const row = res.rows[0];
    const rawWatts = row.watts as (number | null)[];
    const rawHr    = row.hr    as (number | null)[];
    const n = Math.min(rawWatts.length, rawHr.length);

    // Paired index array downsampled to 200 points
    const MAX_PTS = 200;
    const indices = Array.from({ length: n }, (_, i) => i);
    const sampledIdx = downsample(indices, MAX_PTS);

    const watts: (number | null)[] = sampledIdx.map(i => rawWatts[i] ?? null);
    const hr:    (number | null)[] = sampledIdx.map(i => rawHr[i]    ?? null);

    const movingTime = Number(row.moving_time) || 0;
    // Seconds per sample point (approximation)
    const secPerPoint = n > 1 && movingTime > 0 ? movingTime / n : 1;

    return Response.json({
      name:            row.name,
      date:            row.start_date,
      moving_time:     movingTime,
      avg_watts:       Math.round(Number(row.average_watts)),
      avg_hr:          Math.round(Number(row.average_heartrate)),
      np:              Math.round(Number(row.normalized_power)),
      n_samples:       sampledIdx.length,
      sec_per_sample:  Math.round(secPerPoint * (n / sampledIdx.length) * 10) / 10,
      watts,
      hr,
    });
  } catch (err) {
    console.error('[aerobic-efficiency/id]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
