import pool from '@/lib/db';
import { syncHistoricalBatch } from '@/lib/strava-sync';

export const runtime    = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/strava/history
 * Returns { count, oldestDate, newestDate } — info about what's stored.
 *
 * POST /api/strava/history  { before?: number }
 * Fetches up to 100 activities before the given epoch (or before the oldest
 * stored activity if not supplied) and bulk-inserts the summary data.
 * Returns { synced, hasMore, nextBefore, oldestDate }.
 */

export async function GET() {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT
        COUNT(*)                                    AS total,
        MIN(start_date)                             AS oldest,
        MAX(start_date)                             AS newest,
        EXTRACT(EPOCH FROM MIN(start_date))::bigint AS oldest_epoch
      FROM activities
    `);
    const row = res.rows[0] ?? {};
    return Response.json({
      total:       Number(row.total ?? 0),
      oldestDate:  row.oldest  ?? null,
      newestDate:  row.newest  ?? null,
      oldestEpoch: Number(row.oldest_epoch ?? 0),
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as { before?: number };
    const result = await syncHistoricalBatch(body.before ?? undefined);
    return Response.json(result);
  } catch (err) {
    console.error('[history POST]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
