import { getStravaToken, ensureSegmentTables } from '@/lib/strava-sync';
import pool from '@/lib/db';

export const runtime = 'nodejs';

/**
 * Fetch the athlete's starred segments from Strava, store them in the
 * starred_segments table, then mark all stored activities for re-sync
 * so they pick up segment-effort data for any newly-added segments.
 */
export async function GET() {
  const token = await getStravaToken();
  await ensureSegmentTables();

  const starred: Array<Record<string, unknown>> = [];
  let page = 1;
  let total = 0;

  while (true) {
    const res = await fetch(
      `https://www.strava.com/api/v3/segments/starred?page=${page}&per_page=100`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return Response.json(
        { error: `Strava starred segments fetch failed: ${res.status} ${body.slice(0, 200)}` },
        { status: res.status },
      );
    }
    const batch = await res.json() as Array<Record<string, unknown>>;
    if (batch.length === 0) break;
    starred.push(...batch);
    total += batch.length;
    page++;
    if (batch.length < 100) break;
  }

  const client = await pool.connect();
  try {
    for (const seg of starred) {
      const id = Number(seg.id);
      const [startLat, startLng] = (seg.start_latlng as [number, number]) ?? [null, null];
      const [endLat, endLng]     = (seg.end_latlng   as [number, number]) ?? [null, null];
        const segMap = seg.map as Record<string, unknown> | null;

      await client.query(`
        INSERT INTO starred_segments (
          id, name, distance, avg_grade, city, country,
          start_lat, start_lng, end_lat, end_lng,
          elevation_high, elevation_low, total_elevation_gain,
          climb_category, polyline, effort_count, athlete_count
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        ON CONFLICT (id) DO UPDATE SET
          name                = EXCLUDED.name,
          distance            = EXCLUDED.distance,
          avg_grade           = EXCLUDED.avg_grade,
          start_lat           = EXCLUDED.start_lat,
          start_lng           = EXCLUDED.start_lng,
          end_lat             = EXCLUDED.end_lat,
          end_lng             = EXCLUDED.end_lng,
          elevation_high      = EXCLUDED.elevation_high,
          elevation_low       = EXCLUDED.elevation_low,
          total_elevation_gain = EXCLUDED.total_elevation_gain,
          climb_category      = EXCLUDED.climb_category,
          polyline            = EXCLUDED.polyline,
          effort_count        = EXCLUDED.effort_count,
          athlete_count       = EXCLUDED.athlete_count,
          synced_at           = NOW()
      `, [
        id,
        seg.name ?? 'Unnamed',
        seg.distance,
        seg.average_grade ?? 0,
        seg.city ?? null,
        seg.country ?? null,
        startLat,
        startLng,
        endLat,
        endLng,
        seg.elevation_high ?? null,
        seg.elevation_low ?? null,
        seg.total_elevation_gain ?? 0,
        seg.climb_category ?? null,
        segMap?.polyline ?? null,
        seg.effort_count ?? null,
        seg.athlete_count ?? null,
      ]);
    }
  } finally {
    client.release();
  }

  return Response.json({ synced: total });
}

