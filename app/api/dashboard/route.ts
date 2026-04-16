import pool from '@/lib/db';
import { SPORT_FILTERS, SportFilter } from '@/lib/sport-types';
import { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const filter = (req.nextUrl.searchParams.get('filter') ?? 'All') as SportFilter;
  const types: string[] = [...(SPORT_FILTERS[filter] ?? [])];
  const typeClause = types.length > 0
    ? `AND sport_type = ANY($1::text[])`
    : '';
  const params = types.length > 0 ? [types] : [];

  const client = await pool.connect();
  try {
    // MTD
    const mtd = await client.query(`
      SELECT
        COUNT(*) AS activities,
        ROUND(SUM(distance)::numeric / 1000.0, 1) AS km,
        ROUND(SUM(moving_time)::numeric / 3600.0, 1) AS hours,
        ROUND(SUM(COALESCE(tss,0))::numeric, 0) AS tss
      FROM activities
      WHERE date_trunc('month', start_date AT TIME ZONE 'Australia/Sydney')
          = date_trunc('month', NOW() AT TIME ZONE 'Australia/Sydney')
      ${typeClause}
    `, params);

    // WTD (week starts Monday)
    const wtd = await client.query(`
      SELECT
        COUNT(*) AS activities,
        ROUND(SUM(distance)::numeric / 1000.0, 1) AS km,
        ROUND(SUM(moving_time)::numeric / 3600.0, 1) AS hours,
        ROUND(SUM(COALESCE(tss,0))::numeric, 0) AS tss
      FROM activities
      WHERE date_trunc('week', start_date AT TIME ZONE 'Australia/Sydney')
          = date_trunc('week', NOW() AT TIME ZONE 'Australia/Sydney')
      ${typeClause}
    `, params);

    // YTD
    const ytd = await client.query(`
      SELECT
        COUNT(*) AS activities,
        ROUND(SUM(distance)::numeric / 1000.0, 1) AS km,
        ROUND(SUM(moving_time)::numeric / 3600.0, 1) AS hours,
        ROUND(SUM(COALESCE(tss,0))::numeric, 0) AS tss,
        ROUND(SUM(total_elevation_gain)::numeric, 0) AS elevation
      FROM activities
      WHERE EXTRACT(YEAR FROM start_date AT TIME ZONE 'Australia/Sydney')
          = EXTRACT(YEAR FROM NOW() AT TIME ZONE 'Australia/Sydney')
      ${typeClause}
    `, params);

    // Power curve (best efforts approximation from activity-level data)
    const powercurve = await client.query(`
      SELECT
        CASE
          WHEN moving_time <= 300    THEN '5m'
          WHEN moving_time <= 1200   THEN '20m'
          WHEN moving_time <= 2700   THEN '45m'
          WHEN moving_time <= 4500   THEN '75m'
          WHEN moving_time <= 7200   THEN '2h'
          ELSE '3h+'
        END AS duration_bucket,
        MIN(moving_time) AS shortest_time,
        MAX(COALESCE(normalized_power, weighted_average_watts, average_watts)) AS best_power
      FROM activities
      WHERE (normalized_power IS NOT NULL OR weighted_average_watts IS NOT NULL OR average_watts IS NOT NULL)
        AND sport_type IN ('Ride','GravelRide','EMountainBikeRide','MountainBikeRide','EBikeRide')
        AND moving_time > 60
      GROUP BY 1
      ORDER BY MIN(moving_time)
    `);

    // Absolute max power (1s peak)
    const maxPower = await client.query(`
      SELECT MAX(max_watts) AS peak
      FROM activities
      WHERE sport_type IN ('Ride','GravelRide','EMountainBikeRide','MountainBikeRide','EBikeRide')
    `);

    // eFTP: best NP from activities 18-25 min long × 0.95
    const eftp = await client.query(`
      SELECT ROUND((MAX(COALESCE(normalized_power, weighted_average_watts)) * 0.95)::numeric) AS eftp
      FROM activities
      WHERE moving_time BETWEEN 1080 AND 1500
        AND sport_type IN ('Ride','GravelRide','EMountainBikeRide','MountainBikeRide')
        AND COALESCE(normalized_power, weighted_average_watts) IS NOT NULL
    `);

    const durationOrder = ['5m', '20m', '45m', '75m', '2h', '3h+'];
    const pcData = [
      { label: '1s', power: Number(maxPower.rows[0]?.peak ?? 0) },
      ...durationOrder
        .map((label) => {
          const row = powercurve.rows.find((r: { duration_bucket: string }) => r.duration_bucket === label);
          return row ? { label, power: Number(row.best_power) } : null;
        })
        .filter(Boolean),
    ];

    return Response.json({
      mtd: mtd.rows[0],
      wtd: wtd.rows[0],
      ytd: ytd.rows[0],
      powerCurve: pcData,
      eFTP: Number(eftp.rows[0]?.eftp ?? 0),
    });
  } catch (err) {
    console.error('Dashboard API error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
