import pool from '@/lib/db';

export const runtime = 'nodejs';

/**
 * POST /api/activities/backfill/reset
 *
 * Resets segments_synced_at for ALL activities so the backfill will
 * re-fetch segment efforts from Strava for every activity.
 * Run this once after the incorrect bulk-mark, then let the backfill run.
 */
export async function POST() {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE activities SET segments_synced_at = NULL`
    );
    const reset = res.rowCount ?? 0;
    return Response.json({ ok: true, reset });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
