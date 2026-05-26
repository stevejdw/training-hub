import pool from '@/lib/db';

export const runtime = 'nodejs';

/** GET /api/gear → list gear used by at least one activity, with usage count.
 *  Used to populate the gear filter dropdown on the activities page. */
export async function GET() {
  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE gear ADD COLUMN IF NOT EXISTS power_meter TEXT`);
    const res = await client.query(`
      SELECT g.id, g.name, g.nickname, g.retired, g.power_meter,
             COUNT(a.id)::int AS activity_count
      FROM gear g
      LEFT JOIN activities a ON a.gear_id = g.id
      GROUP BY g.id, g.name, g.nickname, g.retired, g.power_meter
      HAVING COUNT(a.id) > 0
      ORDER BY activity_count DESC, g.nickname NULLS LAST, g.name NULLS LAST
    `);
    const noGear = await client.query(
      `SELECT COUNT(*)::int AS n FROM activities WHERE gear_id IS NULL`
    );
    return Response.json({
      gear: res.rows,
      noGearCount: noGear.rows[0]?.n ?? 0,
    });
  } catch (err) {
    return Response.json({ gear: [], error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
