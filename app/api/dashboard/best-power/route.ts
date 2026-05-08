import pool from '@/lib/db';
import { CYCLING_TYPES } from '@/lib/sport-types';
import { NextRequest } from 'next/server';
import { ensureBestPowerTable } from '@/lib/strava-sync';
import { warmMissingActivities, computeBestPower } from '@/lib/best-power';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const sp      = req.nextUrl.searchParams;
  const seconds = Math.max(1, parseInt(sp.get('seconds') ?? '300', 10));
  const days    = Math.max(0, parseInt(sp.get('days')    ?? '90',  10));

  try {
    await ensureBestPowerTable();

    const client = await pool.connect();
    try {
      // Build simple date clause
      let dateClause = '';
      const params: unknown[] = [seconds, CYCLING_TYPES];
      if (days > 0) {
        params.push(days);
        dateClause = `AND a.start_date >= NOW() - ($3::int * INTERVAL '1 day')`;
      }

      // ≤ 2h intervals — try best_power_efforts first, fallback to streams
      if (seconds <= 7200) {
        const res = await client.query(`
          SELECT a.id, a.name, a.start_date, a.sport_type, be.best_watts
          FROM best_power_efforts be
          JOIN activities a ON a.id = be.activity_id
          WHERE be.seconds = $1::int
            AND a.sport_type = ANY($2::text[])
            ${dateClause}
          ORDER BY be.best_watts DESC
          LIMIT 10
        `, params);

        if (res.rows.length > 0) {
          return Response.json({ results: res.rows, seconds });
        }

        // Fallback: scan streams directly (table is cold)
        warmMissingActivities(500).catch(() => {});

        const streamRes = await client.query(`
          SELECT a.id, a.name, a.start_date, a.sport_type, s.watts, array_length(s.watts, 1) as stream_len
          FROM activity_streams s
          JOIN activities a ON a.id = s.activity_id
          WHERE a.sport_type = ANY($2::text[])
            AND array_length(s.watts, 1) >= $1::int
            ${dateClause}
          ORDER BY a.start_date DESC
          LIMIT 200
        `, params);

        // Compute best power for each activity in JS, take top 10
        const computed: { id: number; name: string; start_date: string; sport_type: string; best_watts: number }[] = [];
        for (const row of streamRes.rows) {
          const watts = row.watts as (number | null)[];
          const bestResults = computeBestPower(watts);
          const match = bestResults.find(r => r.seconds === seconds);
          if (match?.best_watts) {
            computed.push({
              id: row.id as number,
              name: row.name as string,
              start_date: row.start_date as string,
              sport_type: row.sport_type as string,
              best_watts: match.best_watts,
            });
          }
        }

        computed.sort((a, b) => b.best_watts - a.best_watts);
        return Response.json({ results: computed.slice(0, 10), seconds });
      }

      // Longer intervals (2h+) — use NP/AP across rides with moving_time >= seconds
      const fallbackRes = await client.query(`
        SELECT a.id, a.name, a.start_date, a.sport_type,
               ROUND(COALESCE(a.normalized_power, a.weighted_average_watts, a.average_watts)::numeric) AS best_watts
        FROM activities a
        WHERE a.sport_type = ANY($2::text[])
          AND a.moving_time >= $1::int
          AND COALESCE(a.normalized_power, a.weighted_average_watts, a.average_watts) IS NOT NULL
          ${dateClause}
        ORDER BY COALESCE(a.normalized_power, a.weighted_average_watts, a.average_watts) DESC
        LIMIT 10
      `, params);
      return Response.json({ results: fallbackRes.rows, seconds });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Dashboard best-power error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
