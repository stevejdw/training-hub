import pool from '@/lib/db';

export const runtime = 'nodejs';

// Returns last 4 calendar weeks (Mon–Sun, Australia/Sydney) of cycling activities
export async function GET() {
  try {
    const client = await pool.connect();
    try {
      // Anchor on current Sydney date, walk back to last 4 Mon–Sun weeks
      const res = await client.query(`
        WITH sydney_now AS (
          SELECT (NOW() AT TIME ZONE 'Australia/Sydney')::date AS today
        ),
        week_starts AS (
          SELECT
            (today - (EXTRACT(DOW FROM today)::int + 6) % 7 * INTERVAL '1 day' - (n * 7) * INTERVAL '1 day')::date AS week_start
          FROM sydney_now, generate_series(0, 3) AS n
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
            (start_date AT TIME ZONE 'Australia/Sydney')::date AS act_date,
            moving_time,
            distance,
            COALESCE(tss, 0)::int AS tss
          FROM activities
          WHERE sport_type = ANY(ARRAY['Ride','VirtualRide','GravelRide','MountainBikeRide','EBikeRide','EMountainBikeRide','Run','Walk'])
            AND (start_date AT TIME ZONE 'Australia/Sydney')::date >= (SELECT MIN(week_start) FROM weeks)
            AND (start_date AT TIME ZONE 'Australia/Sydney')::date <= (SELECT MAX(week_end) FROM weeks)
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
      `);

      return Response.json(res.rows);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Weekly summary error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
