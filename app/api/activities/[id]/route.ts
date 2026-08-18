import pool from '@/lib/db';
import {
  deleteActivity,
  deletePowerData,
  deleteHeartRateData,
  parseScope,
} from '@/lib/activity-delete';

/**
 * DELETE /api/activities/:id?scope=activity|power|hr
 *
 * `activity` (default) removes the activity and everything derived from it;
 * `power` / `hr` strip just that data channel and leave the activity in place.
 * All three are recorded so the next Strava sync doesn't undo them.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const activityId = Number(id);
  if (!Number.isFinite(activityId)) {
    return Response.json({ error: 'Invalid activity id' }, { status: 400 });
  }

  const scope = parseScope(new URL(req.url).searchParams.get('scope'));
  if (!scope) {
    return Response.json({ error: 'scope must be activity, power or hr' }, { status: 400 });
  }

  try {
    const found =
      scope === 'activity' ? await deleteActivity(activityId)
      : scope === 'power'  ? await deletePowerData(activityId)
      :                      await deleteHeartRateData(activityId);

    if (!found) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json({ ok: true, scope });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * PATCH /api/activities/:id — edit user-owned fields.
 *
 * `name` renames the activity; `gear_id` reassigns the bike (null clears it).
 * Both are overwritten by a subsequent Strava sync, which is authoritative
 * for these fields.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { name?: string; gear_id?: string | null };

  const sets: string[] = [];
  const vals: unknown[] = [];
  let p = 1;

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) return Response.json({ error: 'name cannot be empty' }, { status: 400 });
    sets.push(`name = $${p++}`);
    vals.push(name);
  }

  if ('gear_id' in body) {
    const gearId = body.gear_id ? String(body.gear_id).trim() : null;
    if (gearId) {
      const g = await pool.query(`SELECT 1 FROM gear WHERE id = $1`, [gearId]);
      if (g.rowCount === 0) return Response.json({ error: 'unknown gear' }, { status: 400 });
    }
    sets.push(`gear_id = $${p++}`);
    vals.push(gearId);
  }

  if (sets.length === 0) return Response.json({ error: 'name or gear_id required' }, { status: 400 });

  const client = await pool.connect();
  try {
    vals.push(id);
    const r = await client.query(
      `UPDATE activities a SET ${sets.join(', ')}, updated_at = NOW()
       WHERE a.id = $${p}
       RETURNING a.id, a.name, a.gear_id,
                 (SELECT COALESCE(g.nickname, g.name) FROM gear g WHERE g.id = a.gear_id) AS gear_name`,
      vals
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
