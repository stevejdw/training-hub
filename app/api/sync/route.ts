import { syncRecentActivities } from '@/lib/strava-sync';
import { ensureBestPowerTable, warmMissingActivities, backfillBestPowerMetadata } from '@/lib/best-power';
import { syncPowerMeters } from '@/lib/power-meter-sync';
import { getSyncSources, skippedReason } from '@/lib/sync-sources';
import { ensureIdentitySchema } from '@/lib/activity-identity';
import pool from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST() {
  try {
    // Manual Strava sync still respects the single-active-source rule; running
    // it while Garmin is primary is the one way a ride could land twice.
    const { primary, intervalsWellness } = await getSyncSources();
    if (primary !== 'strava') {
      return Response.json(
        { synced: 0, names: [], skipped: skippedReason(primary, 'Strava') },
        { status: 409 }
      );
    }

    // Ensure the best_power_efforts table exists before syncing
    await ensureBestPowerTable();
    // Provider identity columns — idempotent, and the natural place to keep
    // them current since this route already owns the schema-warming work.
    {
      const c = await pool.connect();
      try { await ensureIdentitySchema(c); } finally { c.release(); }
    }
    // Warm up any activities that haven't been processed yet
    const warmResult = await warmMissingActivities(500);
    // Backfill metadata for any legacy rows still missing sport_type/start_date
    const backfilled = await backfillBestPowerMetadata(5000);
    const result = await syncRecentActivities();

    // Auto-update power meter data for the last 60 days from intervals.icu.
    // Fire-and-forget style — don't block the sync response on it.
    if (intervalsWellness) {
      const newest = new Date().toISOString().split('T')[0];
      const oldest = new Date(Date.now() - 60 * 86400_000).toISOString().split('T')[0];
      syncPowerMeters(oldest, newest).catch(() => {});
    }

    return Response.json({ ...result, warmed: warmResult.processed, backfilled });
  } catch (err) {
    console.error('Manual sync error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

// Lightweight read: when was an activity last written/updated?
// Works for both webhook auto-sync and manual sync since both touch updated_at.
export async function GET() {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT GREATEST(MAX(updated_at), MAX(created_at)) AS last_sync FROM activities`
    );
    return Response.json({ last_sync: res.rows[0]?.last_sync ?? null });
  } catch (err) {
    return Response.json({ last_sync: null, error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
