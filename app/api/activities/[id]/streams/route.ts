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
