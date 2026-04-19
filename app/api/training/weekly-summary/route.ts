import pool from '@/lib/db';
import { getProfile } from '@/lib/profile';

export const runtime = 'nodejs';

const CYCLING_TYPES = ['Ride','VirtualRide','GravelRide','MountainBikeRide','EBikeRide','EMountainBikeRide'];

// Returns last 4 calendar weeks (Mon–Sun) of cycling activities
export async function GET() {
  try {
    const profile = await getProfile();
    const tz = profile.timezone || 'Australia/Sydney';

    const client = await pool.connect();
    try {
      const res = await client.query(`
        WITH tz_now AS (
          SELECT (NOW() AT TIME ZONE $1)::date AS today
        ),
        week_starts AS (
          SELECT
            (today - ((EXTRACT(DOW FROM today)::int + 6) % 7) * INTERVAL '1 day' - (n * 7) * INTERVAL '1 day')::date AS week_start
          FROM tz_now, generate_series(0, 3) AS n
        ),
        weeks AS (
          SELECT
            week_start,
            (week_start + INTERVAL '6 days')::date AS week_end
          FROM week_starts
        ),
        acts AS (
          SELECT
            id,
            name,
            sport_type,
            (start_date AT TIME ZONE $1)::date AS act_date,
            moving_time,
            distance,
            COALESCE(tss, 0)::int AS tss
          FROM activities
          WHERE sport_type = ANY($2::text[])
            AND (start_date AT TIME ZONE $1)::date >= (SELECT MIN(week_start) FROM weeks)
            AND (start_date AT TIME ZONE $1)::date <= (SELECT MAX(week_end) FROM weeks)
        )
        SELECT
          w.week_start::text,
          w.week_end::text,
          COALESCE(
            json_agg(
              json_build_object(
                'id',          a.id,
                'name',        a.name,
                'sport_type',  a.sport_type,
                'date',        a.act_date::text,
                'moving_time', a.moving_time,
                'distance',    a.distance,
                'tss',         a.tss
              ) ORDER BY a.act_date, a.id
            ) FILTER (WHERE a.id IS NOT NULL),
            '[]'
          ) AS activities
        FROM weeks w
        LEFT JOIN acts a ON a.act_date BETWEEN w.week_start AND w.week_end
        GROUP BY w.week_start, w.week_end
        ORDER BY w.week_start DESC
      `, [tz, CYCLING_TYPES]);

      return Response.json(res.rows);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Weekly summary error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
