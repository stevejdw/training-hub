import pool from '@/lib/db';
import { CYCLING_TYPES } from '@/lib/sport-types';
import { NextRequest } from 'next/server';
import { ensureBestPowerTableForRead } from '@/lib/best-power';

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function GET(req: NextRequest) {
  const sp      = req.nextUrl.searchParams;
  const seconds = Math.max(1, parseInt(sp.get('seconds') ?? '300', 10));
  const days    = Math.max(0, parseInt(sp.get('days')    ?? '90',  10));

  try {
    await ensureBestPowerTableForRead();

    const client = await pool.connect();
    try {
      // Build date clause
      let dateClause = '';
      const params: unknown[] = [seconds, CYCLING_TYPES];
      if (days > 0) {
        params.push(days);
        dateClause = `AND b.start_date >= NOW() - ($3::int * INTERVAL '1 day')`;
      }

      const res = await client.query(`
        SELECT
          b.activity_id AS id,
          b.start_date,
          b.sport_type,
          b.best_watts,
          a.name
        FROM best_power_efforts b
        JOIN activities a ON a.id = b.activity_id
        WHERE b.seconds = $1::int
          AND b.sport_type = ANY($2::text[])
          AND b.best_watts IS NOT NULL
          ${dateClause}
        ORDER BY b.best_watts DESC
        LIMIT 10
      `, params);

      return Response.json({ results: res.rows, seconds });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Dashboard best-power error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
