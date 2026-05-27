import pool from '@/lib/db';
import { syncPowerMeters } from '@/lib/power-meter-sync';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE activities ADD COLUMN IF NOT EXISTS power_meter TEXT`);
    await client.query(`ALTER TABLE activities ADD COLUMN IF NOT EXISTS power_meter_serial TEXT`);
    const res = await client.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE power_meter IS NOT NULL)::int AS with_pm,
        COUNT(*) FILTER (WHERE average_watts IS NOT NULL AND power_meter IS NULL)::int AS powered_missing
      FROM activities
    `);
    return Response.json(res.rows[0]);
  } finally {
    client.release();
  }
}

/**
 * POST /api/activities/backfill-power-meter
 * Body: { oldest?: string, newest?: string }
 * Defaults to full history (2015-01-01 → today).
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { oldest?: string; newest?: string };
  const newest = body.newest ?? new Date().toISOString().split('T')[0];
  const oldest = body.oldest ?? '2015-01-01';

  const updated = await syncPowerMeters(oldest, newest);

  // Count what's left after the update
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE average_watts IS NOT NULL)::int AS icu_with_power_meter,
        $1::int AS updated
    `, [updated]);
    return Response.json({
      updated,
      icu_with_power_meter: res.rows[0].icu_with_power_meter,
      total_icu: null,
    });
  } finally {
    client.release();
  }
}
