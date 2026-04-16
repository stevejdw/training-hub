import pool from '@/lib/db';
import { CYCLING_TYPES } from '@/lib/sport-types';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const sp      = req.nextUrl.searchParams;
  const seconds = Math.max(1, parseInt(sp.get('seconds') ?? '300', 10));
  const days    = Math.max(0, parseInt(sp.get('days')    ?? '90',  10));

  const client = await pool.connect();
  try {
    const params: unknown[] = [seconds, CYCLING_TYPES];
    let dateClause = '';
    if (days > 0) {
      params.push(days);
      dateClause = `AND a.start_date >= NOW() - ($${params.length}::int * INTERVAL '1 day')`;
    }

    // For each activity with a stored power stream, compute the max rolling-average
    // over `seconds` consecutive samples, then return the top 10.
    const res = await client.query(`
      SELECT
        a.id,
        a.name,
        a.start_date,
        a.sport_type,
        bp.best_watts
      FROM activities a
      JOIN activity_streams s ON s.activity_id = a.id
      JOIN LATERAL (
        SELECT ROUND(MAX(rolling_sum) / $1::numeric)::int AS best_watts
        FROM (
          SELECT SUM(COALESCE(w, 0)::numeric) OVER (
            ORDER BY idx
            ROWS BETWEEN ($1::int - 1) PRECEDING AND CURRENT ROW
          ) AS rolling_sum
          FROM unnest(s.watts) WITH ORDINALITY AS t(w, idx)
        ) sub
      ) bp ON bp.best_watts IS NOT NULL
      WHERE a.average_watts IS NOT NULL
        AND a.sport_type = ANY($2::text[])
        AND array_length(s.watts, 1) >= $1::int
        ${dateClause}
      ORDER BY bp.best_watts DESC
      LIMIT 10
    `, params);

    return Response.json({ results: res.rows, seconds });
  } catch (err) {
    console.error('Dashboard best-power error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
