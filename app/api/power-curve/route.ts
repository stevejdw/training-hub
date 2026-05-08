import pool from '@/lib/db';
import { getProfile, effectiveFtp } from '@/lib/profile';
import { NextRequest } from 'next/server';
import { CYCLING_TYPES } from '@/lib/sport-types';
import { ensureBestPowerTableForRead } from '@/lib/best-power';

export type PeriodKey = string;

function periodToClause(period: PeriodKey): string {
  if (period === 'all') return '';
  if (period.startsWith('y:')) {
    const year = parseInt(period.slice(2), 10);
    return `AND start_date >= '${year}-01-01'::date AND start_date < '${year + 1}-01-01'::date`;
  }
  const intervals: Record<string, string> = {
    '7d':  '7 days',  '30d': '30 days', '60d': '60 days',
    '90d': '90 days', '6m':  '180 days', '1y':  '365 days',
    '4w':  '28 days', '6w':  '42 days', '3m':  '90 days', '12m': '365 days',
  };
  if (intervals[period]) return `AND start_date >= NOW() - INTERVAL '${intervals[period]}'`;
  return '';
}

const CURVE_DURATIONS = [
  { label: '1s',  seconds: 1    }, { label: '5s',  seconds: 5    },
  { label: '15s', seconds: 15   }, { label: '30s', seconds: 30   },
  { label: '1m',  seconds: 60   }, { label: '2m',  seconds: 120  },
  { label: '5m',  seconds: 300  }, { label: '10m', seconds: 600  },
  { label: '20m', seconds: 1200 }, { label: '30m', seconds: 1800 },
  { label: '45m', seconds: 2700 }, { label: '60m', seconds: 3600 },
  { label: '75m', seconds: 4500 }, { label: '90m', seconds: 5400 },
  { label: '2h',  seconds: 7200 }, { label: '3h',  seconds: 10800 },
  { label: '4h',  seconds: 14400 }, { label: '5h',  seconds: 18000 },
  { label: '6h',  seconds: 21600 }, { label: '8h',  seconds: 28800 },
  { label: '10h', seconds: 36000 }, { label: '12h', seconds: 43200 },
  { label: '15h', seconds: 54000 },
];

async function fetchCurve(period: PeriodKey) {
  const clause = periodToClause(period);
  const secondsList = CURVE_DURATIONS.map(d => d.seconds);

  const client = await pool.connect();
  try {
    // Read from denormalized best_power_efforts — no join needed!
    const res = await client.query(`
      SELECT seconds, MAX(best_watts) AS best_watts
      FROM best_power_efforts
      WHERE sport_type = ANY($1::text[])
        AND seconds = ANY($2::int[])
        ${clause}
      GROUP BY seconds
    `, [CYCLING_TYPES, secondsList]);

    const precomputed = new Map<number, number>();
    for (const row of res.rows) {
      precomputed.set(Number(row.seconds), Number(row.best_watts));
    }

    const points: { label: string; power: number }[] = [];

    for (const d of CURVE_DURATIONS) {
      const val = precomputed.get(d.seconds);
      if (val != null && Number.isFinite(val) && val > 0) {
        points.push({ label: d.label, power: val });
        continue;
      }

      // Fallback for long intervals (≥ 30 min): NP/AP from activities table
      if (d.seconds >= 1800) {
        const npRes = await client.query(`
          SELECT ROUND(MAX(COALESCE(normalized_power, weighted_average_watts, average_watts))::numeric) AS best
          FROM activities
          WHERE sport_type = ANY($1::text[])
            AND moving_time >= $2
            AND COALESCE(normalized_power, weighted_average_watts, average_watts) IS NOT NULL
            ${clause}
        `, [CYCLING_TYPES, d.seconds]);
        if (npRes.rows[0]?.best != null && npRes.rows[0].best > 0) {
          points.push({ label: d.label, power: Number(npRes.rows[0].best) });
        }
      }
    }

    return points;
  } finally {
    client.release();
  }
}

export async function GET(req: NextRequest) {
  const p1 = req.nextUrl.searchParams.get('p1') ?? '90d';
  const p2 = req.nextUrl.searchParams.get('p2') ?? 'none';

  try {
    await ensureBestPowerTableForRead();
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
