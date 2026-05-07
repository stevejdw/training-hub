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
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const actId = Number(id);
  if (!Number.isFinite(actId)) {
    return Response.json({ error: 'Invalid activity id' }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const compare = searchParams.get('compare'); // optional: 30d, 90d, 6m, 1y, all

  const client = await pool.connect();
  try {
    // If compare is set, find the best matching activity in that time range
    let compareActId: number | null = null;
    if (compare) {
      const rangeDays: Record<string, number> = {
        '30d': 30, '90d': 90, '6m': 180, '1y': 365, 'all': 99999,
      };
      const days = rangeDays[compare] ?? 30;
      const compareRes = await client.query<{ id: number }>(`
        SELECT a.id
        FROM activities a
        JOIN activity_streams s ON s.activity_id = a.id
        WHERE a.id != $1
          AND a.start_date >= NOW() - ($2 || ' days')::interval
          AND s.watts IS NOT NULL
          AND s.hr IS NOT NULL
          AND a.sport_type = ANY($3::text[])
        ORDER BY a.start_date DESC
        LIMIT 1
      `, [actId, String(days), ['Ride','VirtualRide','GravelRide','MountainBikeRide','EBikeRide','EMountainBikeRide']]);
      if (compareRes.rows.length > 0) {
        compareActId = compareRes.rows[0].id;
      }
    }

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

    // Compute half-split decoupling
    const half = Math.floor(n / 2);

    function avgs(start: number, end: number) {
      let pw = 0, h = 0, c = 0;
      for (let i = start; i < end; i++) {
        const wv = rawWatts[i];
        const hv = rawHr[i];
        if (hv != null && hv > 30 && wv != null) {
          pw += wv;
          h  += hv;
          c++;
        }
      }
      return c > 0 ? { pw: pw / c, hr: h / c } : { pw: 0, hr: 0 };
    }

    const a1 = avgs(0, half);
    const a2 = avgs(half, n);
    const ef1 = a1.hr > 0 ? a1.pw / a1.hr : 0;
    const ef2 = a2.hr > 0 ? a2.pw / a2.hr : 0;
    const decoupling = ef1 > 0 ? ((ef1 - ef2) / ef1) * 100 : 0;

    // Paired index array downsampled to 200 points for chart
    const MAX_PTS = 200;
    const indices = Array.from({ length: n }, (_, i) => i);
    const sampledIdx = downsample(indices, MAX_PTS);

    const watts: (number | null)[] = sampledIdx.map(i => rawWatts[i] ?? null);
    const hr:    (number | null)[] = sampledIdx.map(i => rawHr[i]    ?? null);

    const movingTime = Number(row.moving_time) || 0;
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
      // Half-split data
      pw_h1:           Math.round(a1.pw),
      pw_h2:           Math.round(a2.pw),
      hr_h1:           Math.round(a1.hr),
      hr_h2:           Math.round(a2.hr),
      ef_h1:           Math.round(ef1 * 1000) / 1000,
      ef_h2:           Math.round(ef2 * 1000) / 1000,
      decoupling:      Math.round(decoupling * 10) / 10,
    });
  } catch (err) {
    console.error('[activity-aerobic-efficiency]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
