import pool from '@/lib/db';
import { getProfile, effectiveFtp } from '@/lib/profile';
import { NextRequest } from 'next/server';

export type PeriodKey = string; // '4w' | '6w' | '3m' | '6m' | '12m' | 'y:2026' | 'y:2025' | ... | 'all'

function periodToClause(period: PeriodKey): string {
  if (period.startsWith('y:')) {
    const year = parseInt(period.slice(2), 10);
    return `AND EXTRACT(YEAR FROM start_date AT TIME ZONE 'Australia/Sydney') = ${year}`;
  }
  const intervals: Record<string, string> = {
    '7d':  '7 days',
    '30d': '30 days',
    '60d': '60 days',
    '90d': '90 days',
    '6m':  '180 days',
    '1y':  '365 days',
    // legacy keys kept for backward compat
    '4w':  '28 days',
    '6w':  '42 days',
    '3m':  '90 days',
    '12m': '365 days',
  };
  if (intervals[period]) return `AND start_date >= NOW() - INTERVAL '${intervals[period]}'`;
  return ''; // all time
}

async function fetchCurve(period: PeriodKey) {
  const clause = periodToClause(period);
  const client = await pool.connect();
  try {
    const peakResult = await client.query(`
      SELECT MAX(max_watts) AS peak
      FROM activities
      WHERE sport_type IN ('Ride','GravelRide','EMountainBikeRide','MountainBikeRide','EBikeRide')
      ${clause}
    `);

    const curveResult = await client.query(`
      SELECT
        CASE
          WHEN moving_time <= 300   THEN '5m'
          WHEN moving_time <= 1200  THEN '20m'
          WHEN moving_time <= 2700  THEN '45m'
          WHEN moving_time <= 4500  THEN '75m'
          WHEN moving_time <= 7200  THEN '2h'
          ELSE '3h+'
        END AS bucket,
        MAX(COALESCE(normalized_power, weighted_average_watts, average_watts)) AS best_power
      FROM activities
      WHERE (normalized_power IS NOT NULL OR weighted_average_watts IS NOT NULL OR average_watts IS NOT NULL)
        AND sport_type IN ('Ride','GravelRide','EMountainBikeRide','MountainBikeRide','EBikeRide')
        AND moving_time > 60
        ${clause}
      GROUP BY 1
    `);

    const ORDER = ['1s', '5m', '20m', '45m', '75m', '2h', '3h+'];
    const map: Record<string, number> = { '1s': Number(peakResult.rows[0]?.peak ?? 0) };
    for (const row of curveResult.rows) {
      map[row.bucket] = Number(row.best_power);
    }

    return ORDER
      .filter((label) => map[label] != null && map[label] > 0)
      .map((label) => ({ label, power: map[label] }));
  } finally {
    client.release();
  }
}

export async function GET(req: NextRequest) {
  const p1 = req.nextUrl.searchParams.get('p1') ?? '90d';
  const p2 = req.nextUrl.searchParams.get('p2') ?? 'none';

  try {
    const [curve1, profile] = await Promise.all([
      fetchCurve(p1),
      getProfile(),
    ]);
    const curve2 = p2 !== 'none' ? await fetchCurve(p2) : null;
    const ftp = effectiveFtp(profile);
    return Response.json({ curve1, curve2, ftp });
  } catch (err) {
    console.error('Power curve error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
