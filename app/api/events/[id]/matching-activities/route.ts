import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import { getProfile, saveProfile } from '@/lib/profile';

export const runtime = 'nodejs';

/** Haversine distance in metres. */
function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const aa =
    sinDLat * sinDLat +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * sinDLng * sinDLng;
  return R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
}

/** The route sample points the corridor test measures against. */
function routeSamplePoints(routeLatLng: [number, number][]): [number, number][] {
  const nSamples = 10;
  const step = Math.max(1, Math.floor(routeLatLng.length / (nSamples + 1)));
  const pts: [number, number][] = [];
  for (let s = 0; s < nSamples; s++) {
    const rPt = routeLatLng[step * (s + 1)];
    if (rPt) pts.push(rPt);
  }
  return pts;
}

/**
 * Corridor test for every candidate at once, evaluated in Postgres.
 *
 * Previously this ran one `SELECT latlng` per candidate inside a loop — up to
 * 30 sequential queries each shipping a full coordinate array (~120 KB), the
 * single largest read in the app. The distances are now computed where the data
 * already lives, so only one hit-count per activity comes back.
 *
 * The bounding-box predicate is an optimisation, not a change in behaviour:
 * 0.01° of latitude is ~1.1 km, so every point within the 500 m threshold is
 * inside the box, and points outside it can never be the minimum that decides
 * the comparison.
 */
async function corridorHits(
  client: PoolClient,
  activityIds: number[],
  samples: [number, number][],
): Promise<Map<number, number>> {
  const res = await client.query<{ activity_id: string; hits: string }>(
    `WITH pts AS (
       SELECT s.activity_id, s.latlng[g][1] AS lat, s.latlng[g][2] AS lng
         FROM activity_streams s,
              generate_subscripts(s.latlng, 1) AS g
        WHERE s.activity_id = ANY($1::bigint[])
          AND s.latlng IS NOT NULL
          AND COALESCE(array_length(s.latlng, 1), 0) >= 10
     ),
     samp AS (
       SELECT ord, lat, lng
         FROM unnest($2::float8[], $3::float8[]) WITH ORDINALITY AS t(lat, lng, ord)
     ),
     nearest AS (
       SELECT p.activity_id, sa.ord,
              MIN(6371000 * 2 * atan2(sqrt(x.aa), sqrt(1 - x.aa))) AS dist
         FROM pts p
         JOIN samp sa
           ON abs(p.lat - sa.lat) < 0.01
          AND abs(p.lng - sa.lng) < 0.02
         CROSS JOIN LATERAL (
           SELECT power(sin(radians(p.lat - sa.lat) / 2), 2)
                + cos(radians(sa.lat)) * cos(radians(p.lat))
                * power(sin(radians(p.lng - sa.lng) / 2), 2) AS aa
         ) x
        GROUP BY p.activity_id, sa.ord
     )
     SELECT activity_id, COUNT(*) FILTER (WHERE dist <= 500) AS hits
       FROM nearest
      GROUP BY activity_id`,
    [activityIds, samples.map(p => p[0]), samples.map(p => p[1])],
  );

  const out = new Map<number, number>();
  for (const row of res.rows) out.set(Number(row.activity_id), Number(row.hits));
  return out;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;

  const profile = await getProfile();
  const event   = profile.events.find(e => (e.id ?? '') === eventId);
  if (!event) return Response.json({ error: 'Event not found' }, { status: 404 });

  const route = event.route!;
  const routeDistM = route?.distance_m ?? 0;
  if (!routeDistM) return Response.json({ activities: [], linked_ids: event.linked_activity_ids ?? [] });

  const routeLatLng = route.stream_latlng;

  const client = await pool.connect();
  try {
    // Step 1: find candidate activities by distance (±20 %)
    const candidates = await client.query<{
      id: string;
      name: string;
      start_date: string;
      distance: string;
      total_elevation_gain: string;
      moving_time: string;
      average_watts: string | null;
      normalized_power: string | null;
    }>(`
      SELECT id, name, start_date, distance, total_elevation_gain,
             moving_time, average_watts, normalized_power
      FROM activities
      WHERE sport_type = ANY(ARRAY['Ride','VirtualRide'])
        AND distance BETWEEN $1 * 0.80 AND $1 * 1.20
      ORDER BY start_date DESC
      LIMIT 30
    `, [routeDistM]);

    // If no candidates, return empty early
    if (candidates.rows.length === 0) {
      return Response.json({ activities: [], linked_ids: event.linked_activity_ids ?? [] });
    }

    const candidateIds = candidates.rows.map(r => Number(r.id));

    // Step 2: filter by GPS corridor when route has latlng data
    const activities: Array<{
      id: number;
      name: string;
      start_date: string;
      distance_m: number;
      total_elevation_gain: number;
      moving_time: number;
      average_watts: number | null;
      normalized_power: number | null;
    }> = [];

    const useCorridor = Boolean(routeLatLng && routeLatLng.length >= 10);
    const hitsByActivity = useCorridor
      ? await corridorHits(client, candidateIds, routeSamplePoints(routeLatLng!))
      : new Map<number, number>();

    for (const r of candidates.rows) {
      const activityId = Number(r.id);
      // An activity with no usable coordinates has no hits and is rejected,
      // matching the previous behaviour.
      const accept = useCorridor ? (hitsByActivity.get(activityId) ?? 0) >= 3 : true;

      if (accept) {
        activities.push({
          id:                   activityId,
          name:                 r.name,
          start_date:           r.start_date,
          distance_m:           Number(r.distance),
          total_elevation_gain: Number(r.total_elevation_gain),
          moving_time:          Number(r.moving_time),
          average_watts:        r.average_watts  ? Number(r.average_watts)  : null,
          normalized_power:     r.normalized_power ? Number(r.normalized_power) : null,
        });
      }
    }

    return Response.json({
      activities,
      linked_ids: event.linked_activity_ids ?? [],
    });
  } finally {
    client.release();
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;
  const body = await req.json() as { linked_activity_ids: number[] };

  const profile = await getProfile();
  const events  = profile.events.map(e =>
    (e.id ?? '') === eventId
      ? { ...e, linked_activity_ids: body.linked_activity_ids }
      : e,
  );
  await saveProfile({ ...profile, events });
  return Response.json({ ok: true });
}
