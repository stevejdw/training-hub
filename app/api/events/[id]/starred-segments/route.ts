import pool from '@/lib/db';
import { getProfile } from '@/lib/profile';
import { findNearestRouteKmWithDist } from '@/lib/pacing';

export const runtime = 'nodejs';

export interface RouteStarredSegment {
  id:          number;
  name:        string;
  start_km:    number;
  end_km:      number;
  start_dist_m: number;
  end_dist_m:   number;
  distance_m:  number;
  avg_grade:   number;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;

  const profile = await getProfile();
  const event   = profile.events.find(e => (e.id ?? '') === eventId);
  if (!event || !event.route) {
    return Response.json({ error: 'Event or route not found' }, { status: 404 });
  }

  const route = event.route;
  if (!route.stream_latlng || route.stream_latlng.length < 10) {
    return Response.json({ starred: [] });
  }

  const client = await pool.connect();
  try {
    const ssRes = await client.query<{
      id: number; name: string;
      start_lat: number; start_lng: number;
      end_lat: number; end_lng: number;
      distance: number;
      avg_grade: number;
    }>(`SELECT id, name, start_lat, start_lng, end_lat, end_lng, distance, avg_grade
        FROM starred_segments WHERE start_lat IS NOT NULL AND end_lat IS NOT NULL
        ORDER BY distance DESC`);

    const starred: RouteStarredSegment[] = [];
    for (const ss of ssRes.rows) {
      const startInfo = findNearestRouteKmWithDist(route.stream_latlng, route.stream_distance_km, [ss.start_lat, ss.start_lng]);
      const endInfo   = findNearestRouteKmWithDist(route.stream_latlng, route.stream_distance_km, [ss.end_lat, ss.end_lng]);
      if (startInfo && endInfo && endInfo.km > startInfo.km) {
        starred.push({
          id: ss.id,
          name: ss.name,
          start_km: Math.round(startInfo.km * 10) / 10,
          end_km: Math.round(endInfo.km * 10) / 10,
          start_dist_m: startInfo.distM,
          end_dist_m: endInfo.distM,
          distance_m: ss.distance,
          avg_grade: ss.avg_grade,
        });
      }
    }

    return Response.json({ starred });
  } finally {
    client.release();
  }
}
