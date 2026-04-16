import pool from '@/lib/db';
import { SPORT_FILTERS, SportFilter } from '@/lib/sport-types';
import { NextRequest } from 'next/server';

type Period = '30d' | '90d' | '365d' | 'all';
type Compare = 'none' | 'prev' | 'year';

function periodInterval(p: Period): string | null {
  if (p === '30d') return '30 days';
  if (p === '90d') return '90 days';
  if (p === '365d') return '365 days';
  return null; // all time
}

async function getPowerCurve(client: import('pg').PoolClient, periodFilter: string) {
  const result = await client.query(`
    SELECT
      CASE
        WHEN moving_time <= 300   THEN '5m'
        WHEN moving_time <= 1200  THEN '20m'
        WHEN moving_time <= 2700  THEN '45m'
        WHEN moving_time <= 4500  THEN '75m'
        WHEN moving_time <= 7200  THEN '2h'
        ELSE '3h+'
      END AS duration_bucket,
      MIN(moving_time) AS shortest_time,
      MAX(COALESCE(normalized_power, weighted_average_watts, average_watts)) AS best_power
    FROM activities
    WHERE (normalized_power IS NOT NULL OR weighted_average_watts IS NOT NULL OR average_watts IS NOT NULL)
      AND sport_type IN ('Ride','GravelRide','EMountainBikeRide','MountainBikeRide','EBikeRide')
      AND moving_time > 60
      ${periodFilter}
    GROUP BY 1
    ORDER BY MIN(moving_time)
  `);
  return result.rows;
}

function buildPowerCurveData(rows: { duration_bucket: string; best_power: string }[], maxWatts: number) {
  const durationOrder = ['5m', '20m', '45m', '75m', '2h', '3h+'];
  return [
    { label: '1s', power: maxWatts },
    ...durationOrder
      .map((label) => {
        const row = rows.find((r) => r.duration_bucket === label);
        return row ? { label, power: Number(row.best_power) } : null;
      })
      .filter(Boolean),
  ] as { label: string; power: number }[];
}

export async function GET(req: NextRequest) {
  const filter = (req.nextUrl.searchParams.get('filter') ?? 'All') as SportFilter;
  const period = (req.nextUrl.searchParams.get('period') ?? '90d') as Period;
  const compare = (req.nextUrl.searchParams.get('compare') ?? 'none') as Compare;

  const types: string[] = [...(SPORT_FILTERS[filter] ?? [])];
  const typeClause = types.length > 0 ? `AND sport_type = ANY($1::text[])` : '';
  const params = types.length > 0 ? [types] : [];

  const interval = periodInterval(period);

  // Period filter clauses for power curve
  const currentPeriodFilter = interval ? `AND start_date >= NOW() - INTERVAL '${interval}'` : '';

  let comparePeriodFilter = '';
  let compareLabel = '';
  if (compare === 'prev' && interval) {
    comparePeriodFilter = `AND start_date >= NOW() - INTERVAL '${parseInt(interval) * 2} ${interval.split(' ')[1]}' AND start_date < NOW() - INTERVAL '${interval}'`;
    compareLabel = `Prev ${period}`;
  } else if (compare === 'year' && interval) {
    comparePeriodFilter = `AND start_date >= NOW() - INTERVAL '1 year' - INTERVAL '${interval}' AND start_date < NOW() - INTERVAL '1 year'`;
    compareLabel = '1yr ago';
  } else if (compare === 'year' && !interval) {
    comparePeriodFilter = `AND start_date < NOW() - INTERVAL '1 year'`;
    compareLabel = 'Before this year';
  }

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

    // WTD
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

    // Max 1s power
    const maxPower = await client.query(`
      SELECT MAX(max_watts) AS peak
      FROM activities
      WHERE sport_type IN ('Ride','GravelRide','EMountainBikeRide','MountainBikeRide','EBikeRide')
      ${currentPeriodFilter}
    `);

    const comparePeak = compare !== 'none' && comparePeriodFilter
      ? await client.query(`
          SELECT MAX(max_watts) AS peak
          FROM activities
          WHERE sport_type IN ('Ride','GravelRide','EMountainBikeRide','MountainBikeRide','EBikeRide')
          ${comparePeriodFilter}
        `)
      : null;

    // Power curve rows
    const pcRows = await getPowerCurve(client, currentPeriodFilter);
    const pcCompareRows = compare !== 'none' && comparePeriodFilter
      ? await getPowerCurve(client, comparePeriodFilter)
      : null;

    // eFTP
    const eftp = await client.query(`
      SELECT ROUND((MAX(COALESCE(normalized_power, weighted_average_watts)) * 0.95)::numeric) AS eftp
      FROM activities
      WHERE moving_time BETWEEN 1080 AND 1500
        AND sport_type IN ('Ride','GravelRide','EMountainBikeRide','MountainBikeRide')
        AND COALESCE(normalized_power, weighted_average_watts) IS NOT NULL
        ${currentPeriodFilter}
    `);

    const powerCurve = buildPowerCurveData(pcRows, Number(maxPower.rows[0]?.peak ?? 0));
    const powerCurveCompare = pcCompareRows
      ? buildPowerCurveData(pcCompareRows, Number(comparePeak?.rows[0]?.peak ?? 0))
      : null;

    return Response.json({
      mtd: mtd.rows[0],
      wtd: wtd.rows[0],
      ytd: ytd.rows[0],
      powerCurve,
      powerCurveCompare,
      compareLabel,
      eFTP: Number(eftp.rows[0]?.eftp ?? 0),
    });
  } catch (err) {
    console.error('Dashboard API error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
