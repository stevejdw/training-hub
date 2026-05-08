import pool from '@/lib/db';
import { CYCLING_TYPES } from '@/lib/sport-types';
import { NextRequest } from 'next/server';
import { ensureBestPowerTable } from '@/lib/strava-sync';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const sp      = req.nextUrl.searchParams;
  const seconds = Math.max(1, parseInt(sp.get('seconds') ?? '300', 10));
  const days    = Math.max(0, parseInt(sp.get('days')    ?? '90',  10));

  await ensureBestPowerTable();

  const client = await pool.connect();
  try {
    const params: unknown[] = [seconds, CYCLING_TYPES];
    let dateClause = '';
    if (days > 0) {
      params.push(days);
      dateClause = `AND a.start_date >= NOW() - ($${params.length}::int * INTERVAL '1 day')`;
    }

    // Pre-computed intervals (up to 2h) — read from best_power_efforts
    if (seconds <= 7200) {
      const res = await client.query(`
        SELECT
          a.id,
          a.name,
          a.start_date,
          a.sport_type,
          be.best_watts
        FROM best_power_efforts be
        JOIN activities a ON a.id = be.activity_id
        WHERE be.seconds = $1::int
          AND a.average_watts IS NOT NULL
          AND a.sport_type = ANY($2::text[])
          ${dateClause}
        ORDER BY be.best_watts DESC
        LIMIT 10
      `, params);
      return Response.json({ results: res.rows, seconds });
    }

    // Longer intervals (2h+) — fall back to average/NP across long rides
    const fallbackRes = await client.query(`
      SELECT
        a.id,
        a.name,
        a.start_date,
        a.sport_type,
        ROUND(COALESCE(a.normalized_power, a.weighted_average_watts, a.average_watts)::numeric) AS best_watts
      FROM activities a
      WHERE a.average_watts IS NOT NULL
        AND a.sport_type = ANY($2::text[])
        AND a.moving_time >= $1::int
        ${dateClause}
      ORDER BY COALESCE(a.normalized_power, a.weighted_average_watts, a.average_watts) DESC
      LIMIT 10
    `, params);
    return Response.json({ results: fallbackRes.rows, seconds });
  } catch (err) {
    console.error('Dashboard best-power error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
