import pool from '@/lib/db';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const client = await pool.connect();
  try {
    const activityResult = await client.query(
      `SELECT * FROM activities WHERE id = $1`,
      [id]
    );
    if (activityResult.rows.length === 0) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    const lapsResult = await client.query(
      `SELECT * FROM laps WHERE activity_id = $1 ORDER BY lap_index ASC`,
      [id]
    );

    return Response.json({
      activity: activityResult.rows[0],
      laps: lapsResult.rows,
    });
  } finally {
    client.release();
  }
}
