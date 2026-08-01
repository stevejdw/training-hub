import pool from '@/lib/db';

export const runtime = 'nodejs';

/** Raw streams for the desktop activity workbench. watts/hr are full
 *  1 Hz resolution; altitude_m/distance_km/latlng/time_s are downsampled
 *  to ≤5000 points at sync time — clients must index watts/hr via time_s
 *  rather than zipping arrays. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const activityId = Number(id);
  if (!Number.isFinite(activityId)) {
    return Response.json({ error: 'Invalid activity id' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    // Callers treat a missing time_s as "not synced yet" and discard the whole
    // payload before triggering a backfill, so check for it before reading the
    // arrays — otherwise every view of an unsynced activity ships ~300 KB out
    // of the database purely to throw it away.
    const ready = await client.query<{ has_time: boolean }>(
      `SELECT COALESCE(array_length(time_s, 1), 0) > 0 AS has_time
         FROM activity_streams WHERE activity_id = $1`,
      [activityId]
    );

    if (ready.rows.length === 0 || !ready.rows[0].has_time) {
      return Response.json({ streams: null });
    }

    const res = await client.query(
      `SELECT watts, hr, altitude_m, distance_km, latlng, time_s
       FROM activity_streams WHERE activity_id = $1`,
      [activityId]
    );

    if (res.rows.length === 0) {
      return Response.json({ streams: null });
    }

    const row = res.rows[0];
    return Response.json({
      streams: {
        watts:       row.watts       ?? null,
        hr:          row.hr          ?? null,
        altitude_m:  row.altitude_m  ?? null,
        distance_km: row.distance_km ?? null,
        latlng:      row.latlng      ?? null,
        time_s:      row.time_s      ?? null,
      },
    });
  } finally {
    client.release();
  }
}
