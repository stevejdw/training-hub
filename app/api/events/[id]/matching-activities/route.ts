import pool from '@/lib/db';
import { getProfile, saveProfile } from '@/lib/profile';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;

  const profile = await getProfile();
  const event   = profile.events.find(e => (e.id ?? '') === eventId);
  if (!event) return Response.json({ error: 'Event not found' }, { status: 404 });

  const routeDistM = event.route?.distance_m ?? 0;
  if (!routeDistM) return Response.json({ activities: [], linked_ids: event.linked_activity_ids ?? [] });

  const client = await pool.connect();
  try {
    const res = await client.query<{
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

    const activities = res.rows.map(r => ({
      id:                   Number(r.id),
      name:                 r.name,
      start_date:           r.start_date,
      distance_m:           Number(r.distance),
      total_elevation_gain: Number(r.total_elevation_gain),
      moving_time:          Number(r.moving_time),
      average_watts:        r.average_watts  ? Number(r.average_watts)  : null,
      normalized_power:     r.normalized_power ? Number(r.normalized_power) : null,
    }));

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
