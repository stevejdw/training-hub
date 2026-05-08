import { syncRecentActivities } from '@/lib/strava-sync';
import { ensureBestPowerTable, warmMissingActivities } from '@/lib/best-power';
import pool from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST() {
  try {
    // Ensure the best_power_efforts table exists before syncing
    await ensureBestPowerTable();
    // Warm up any activities that haven't been processed yet
    await warmMissingActivities(500);
    const result = await syncRecentActivities();
    return Response.json(result);
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
