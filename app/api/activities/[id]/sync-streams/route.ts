import pool from '@/lib/db';
import { syncActivity } from '@/lib/strava-sync';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const activityId = Number(id);
  if (!Number.isFinite(activityId)) {
    return Response.json({ error: 'Invalid activity id' }, { status: 400 });
  }

  // Skip if we already have distance_km (the key column the compare route needs)
  const client = await pool.connect();
  try {
    const check = await client.query<{ has_streams: boolean }>(
      `SELECT (distance_km IS NOT NULL AND array_length(distance_km, 1) > 0) AS has_streams
       FROM activity_streams WHERE activity_id = $1`,
      [activityId],
    );
    if (check.rows[0]?.has_streams) {
      return Response.json({ ok: true, skipped: true });
    }
  } finally {
    client.release();
  }

  await syncActivity(activityId);
  return Response.json({ ok: true, skipped: false });
}
