import pool from '@/lib/db';

export const runtime = 'nodejs';

/**
 * POST /api/activities/backfill
 *
 * One-time repair for historical activities:
 *  1. Fix all segment_efforts rows where segment_id IS NULL by matching on name
 *     against starred_segments (instant, no Strava calls).
 *  2. Mark all remaining NULL segments_synced_at activities as done — their
 *     efforts were stored by old sync code, they don't need re-fetching.
 *
 * Safe to run multiple times (idempotent).
 */
export async function POST() {
  const client = await pool.connect();
  try {
    // 1. Repair null segment_ids across ALL starred segments
    const repairRes = await client.query(`
      UPDATE segment_efforts se
      SET segment_id = ss.id
      FROM starred_segments ss
      WHERE se.segment_id IS NULL
        AND se.name = ss.name
    `);
    const repaired = repairRes.rowCount ?? 0;

    // 2. Mark all old activities as segments-synced so the counter drops to 0
    const markRes = await client.query(`
      UPDATE activities
      SET segments_synced_at = NOW()
      WHERE segments_synced_at IS NULL
    `);
    const marked = markRes.rowCount ?? 0;

    // 3. Summary stats
    const statsRes = await client.query(`
      SELECT
        COUNT(*)                                              AS total_efforts,
        COUNT(*) FILTER (WHERE segment_id IS NOT NULL)       AS with_segment_id,
        COUNT(*) FILTER (WHERE segment_id IS NULL)           AS still_null
      FROM segment_efforts
    `);

    return Response.json({
      ok: true,
      repaired,
      marked,
      stats: statsRes.rows[0],
    });
  } catch (err) {
    console.error('[backfill POST]', err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
