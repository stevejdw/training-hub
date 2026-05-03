import pool from '@/lib/db';
import { getProfile } from '@/lib/profile';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; climbIdx: string }> },
) {
  const { id: eventId, climbIdx: climbIdxStr } = await params;
  const climbIdx = parseInt(climbIdxStr, 10);

  const profile = await getProfile();
  const event   = profile.events.find(e => (e.id ?? '') === eventId);
  if (!event) return Response.json({ error: 'Event not found' }, { status: 404 });

  const climb = event.pacing_strategy?.climbs?.[climbIdx];
  if (!climb) return Response.json({ efforts: [], noClimb: true });

  const distM   = climb.distance_km * 1000;
  const minDist = distM * 0.75;
  const maxDist = distM * 1.25;

  const client = await pool.connect();
  try {
    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables WHERE table_name = 'segment_efforts'
      )
    `);
    if (!tableExists.rows[0].exists) {
      return Response.json({ efforts: [], noTable: true });
    }

    const res = await client.query(`
      SELECT
        se.id,
        se.name,
        TO_CHAR(se.start_date AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD') AS date,
        se.moving_time,
        se.elapsed_time,
        ROUND(se.distance)::int          AS distance_m,
        se.average_watts,
        se.average_heartrate,
        se.pr_rank,
        se.kom_rank,
        a.id   AS activity_id,
        a.name AS activity_name
      FROM segment_efforts se
      JOIN activities a ON a.id = se.activity_id
      WHERE se.distance BETWEEN $1 AND $2
        AND a.sport_type = ANY(ARRAY[
          'Ride','GravelRide','VirtualRide','MountainBikeRide',
          'EBikeRide','EMountainBikeRide'
        ])
      ORDER BY se.start_date DESC
      LIMIT 30
    `, [minDist, maxDist]);

    return Response.json({ efforts: res.rows });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
