import pool from '@/lib/db';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { name?: string };
  const name = (body.name ?? '').trim();
  if (!name) return Response.json({ error: 'name required' }, { status: 400 });

  const client = await pool.connect();
  try {
    const r = await client.query(
      `UPDATE activities SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name`,
      [name, id]
    );
    if (r.rowCount === 0) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json({ ok: true, activity: r.rows[0] });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const client = await pool.connect();
  try {
    const activityResult = await client.query(
      `SELECT a.*, COALESCE(g.nickname, g.name) AS gear_name
       FROM activities a
       LEFT JOIN gear g ON g.id = a.gear_id
       WHERE a.id = $1`,
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
