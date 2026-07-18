import pool from '@/lib/db';

export const runtime = 'nodejs';

/** PATCH /api/gear/[id] — rename a gear's nickname. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { nickname?: string; power_meter?: string | null };
  const nickname = (body.nickname ?? '').trim();
  const hasPowerMeter = 'power_meter' in body;
  if (!nickname && !hasPowerMeter) return Response.json({ error: 'nickname or power_meter required' }, { status: 400 });

  const client = await pool.connect();
  try {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let p = 1;
    if (nickname) { sets.push(`nickname = $${p++}`); vals.push(nickname); }
    if (hasPowerMeter) { sets.push(`power_meter = $${p++}`); vals.push(body.power_meter ?? null); }
    vals.push(id);
    const r = await client.query(
      `UPDATE gear SET ${sets.join(', ')} WHERE id = $${p} RETURNING id, name, nickname, power_meter`,
      vals
    );
    if (r.rowCount === 0) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json({ ok: true, gear: r.rows[0] });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
