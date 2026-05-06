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

function sharesGpsCorridor(
  routeLatLng: [number, number][],
  actLatLng: [number, number][],
): boolean {
  const nSamples = 10;
  const step = Math.max(1, Math.floor(routeLatLng.length / (nSamples + 1)));
  let hits = 0;
  for (let s = 0; s < nSamples; s++) {
    const rPt = routeLatLng[step * (s + 1)];
    if (!rPt) continue;
    let minDist = Infinity;
    // Scan ALL activity points to find closest match
    for (let i = 0; i < actLatLng.length; i++) {
      const d = haversineM(rPt, actLatLng[i]);
      if (d < minDist) minDist = d;
    }
    if (minDist <= 500) hits++;
  }
  return hits >= 3;
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

    // Debug: check if candidates have latlng data
    const candidateIds = candidates.rows.map(r => Number(r.id));
    const latlngCheck = await client.query<{ activity_id: number; ll_len: number | null }>(`
      SELECT s.activity_id, array_length(s.latlng, 1) AS ll_len
      FROM activity_streams s
      WHERE s.activity_id = ANY($1)
    `, [candidateIds]);

    const llMap: Record<number, number> = {};
    for (const row of latlngCheck.rows) {
      llMap[row.activity_id] = row.ll_len ?? 0;
    }

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

    for (const r of candidates.rows) {
      const activityId = Number(r.id);
      let accept = true;

      if (routeLatLng && routeLatLng.length >= 10) {
        // Fetch activity latlng stream to check GPS overlap
        const llRes = await client.query<{ latlng: unknown }>(
          `SELECT latlng FROM activity_streams WHERE activity_id = $1 AND latlng IS NOT NULL`,
          [activityId],
        );
        const actLlRaw = llRes.rows[0]?.latlng;
        let actLatLng: [number, number][] | undefined;
        if (actLlRaw != null && Array.isArray(actLlRaw) && actLlRaw.length >= 10) {
          actLatLng = [];
          for (const item of actLlRaw) {
            if (Array.isArray(item) && item.length >= 2) {
              const lat = Number(item[0]);
              const lng = Number(item[1]);
              if (Number.isFinite(lat) && Number.isFinite(lng)) {
                actLatLng.push([lat, lng]);
              }
            }
          }
        }
        if (actLatLng && actLatLng.length >= 10) {
          accept = sharesGpsCorridor(routeLatLng, actLatLng);
        } else {
          console.log(`ACTIVITY ${activityId}: no latlng data on activity stream, raw=${typeof actLlRaw} isArr=${Array.isArray(actLlRaw)} len=${Array.isArray(actLlRaw) ? actLlRaw.length : '?'}`);
          accept = false;
        }
      }

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
