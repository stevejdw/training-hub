import pool from '@/lib/db';

export const runtime = 'nodejs';

/** PATCH /api/gear/[id] — rename a gear's nickname. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { nickname?: string };
  const nickname = (body.nickname ?? '').trim();
  if (!nickname) return Response.json({ error: 'nickname required' }, { status: 400 });

  const client = await pool.connect();
  try {
    const r = await client.query(
      `UPDATE gear SET nickname = $1 WHERE id = $2 RETURNING id, name, nickname`,
      [nickname, id]
    );
    if (r.rowCount === 0) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json({ ok: true, gear: r.rows[0] });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
