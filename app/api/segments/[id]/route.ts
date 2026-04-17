import pool from '@/lib/db';
import { getStravaToken, ensureSegmentTables } from '@/lib/strava-sync';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await ensureSegmentTables();
  const client = await pool.connect();

  try {
    // Return cached if we already have full detail
    const cached = await client.query(
      `SELECT * FROM starred_segments WHERE id = $1`, [id]
    );
    if (cached.rows.length > 0 && cached.rows[0].polyline) {
      return Response.json({ segment: cached.rows[0] });
    }

    // Fetch full detail + streams from Strava in parallel
    const token = await getStravaToken();
    const [detailRes, streamRes] = await Promise.all([
      fetch(`https://www.strava.com/api/v3/segments/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(
        `https://www.strava.com/api/v3/segments/${id}/streams?keys=altitude,distance&key_by_type=true`,
        { headers: { Authorization: `Bearer ${token}` } }
      ),
    ]);

    if (!detailRes.ok) throw new Error(`Strava segment fetch failed: ${detailRes.status}`);
    const s = await detailRes.json() as Record<string, unknown>;

    const streamData    = streamRes.ok ? await streamRes.json() as Record<string, unknown> : null;
    const altitudeStream = (streamData?.altitude as { data: number[] } | null)?.data ?? null;
    const distanceStream = (streamData?.distance as { data: number[] } | null)?.data ?? null;

    const latlng  = s.start_latlng as [number, number] | null;
    const mapData = s.map as Record<string, string> | null;

    await client.query(`
      INSERT INTO starred_segments (
        id, name, distance, avg_grade, city, country,
        start_lat, start_lng,
        elevation_high, elevation_low, total_elevation_gain,
        climb_category, polyline, effort_count, athlete_count,
        altitude_stream, distance_stream, synced_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
      ON CONFLICT (id) DO UPDATE SET
        elevation_high       = EXCLUDED.elevation_high,
        elevation_low        = EXCLUDED.elevation_low,
        total_elevation_gain = EXCLUDED.total_elevation_gain,
        climb_category       = EXCLUDED.climb_category,
        polyline             = EXCLUDED.polyline,
        effort_count         = EXCLUDED.effort_count,
        athlete_count        = EXCLUDED.athlete_count,
        altitude_stream      = EXCLUDED.altitude_stream,
        distance_stream      = EXCLUDED.distance_stream,
        start_lat            = EXCLUDED.start_lat,
        start_lng            = EXCLUDED.start_lng,
        synced_at            = NOW()
    `, [
      s.id, s.name, s.distance, s.average_grade, s.city, s.country,
      latlng?.[0] ?? null, latlng?.[1] ?? null,
      s.elevation_high, s.elevation_low, s.total_elevation_gain,
      s.climb_category, mapData?.polyline ?? null,
      s.effort_count, s.athlete_count,
      altitudeStream, distanceStream,
    ]);

    const updated = await client.query(`SELECT * FROM starred_segments WHERE id = $1`, [id]);
    return Response.json({ segment: updated.rows[0] });
  } finally {
    client.release();
  }
}
