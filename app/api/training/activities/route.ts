import { NextRequest } from 'next/server';
import pool from '@/lib/db';

export const runtime = 'nodejs';

// Returns activities for a date range (for linking to training days)
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const from = sp.get('from');
    const to = sp.get('to');

    if (!from || !to) {
      return Response.json({ error: 'from and to params required' }, { status: 400 });
    }

    const client = await pool.connect();
    try {
      const res = await client.query(`
        SELECT
          id,
          name,
          sport_type,
          (start_date AT TIME ZONE 'Australia/Sydney')::date::text AS date,
          moving_time,
          distance,
          total_elevation_gain,
          average_watts,
          normalized_power,
          weighted_average_watts,
          average_heartrate,
          COALESCE(tss, 0)::int AS tss,
          intensity_factor
        FROM activities
        WHERE (start_date AT TIME ZONE 'Australia/Sydney')::date >= $1
          AND (start_date AT TIME ZONE 'Australia/Sydney')::date <= $2
        ORDER BY start_date
      `, [from, to]);

      return Response.json(res.rows);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Training activities error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
