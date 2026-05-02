import pool from '@/lib/db';
import { getProfile, effectiveFtp } from '@/lib/profile';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

const DURATIONS = [
  { label: '1s',  s: 1    },
  { label: '5s',  s: 5    },
  { label: '30s', s: 30   },
  { label: '1m',  s: 60   },
  { label: '5m',  s: 300  },
  { label: '10m', s: 600  },
  { label: '20m', s: 1200 },
  { label: '30m', s: 1800 },
  { label: '60m', s: 3600 },
];

const CYCLING_SPORTS = ['Ride','GravelRide','EMountainBikeRide','MountainBikeRide','EBikeRide'];

function rollingMax(watts: number[], windowSec: number): number | null {
  const n = watts.length;
  if (n < windowSec) return null;
  let windowSum = 0;
  for (let i = 0; i < windowSec; i++) windowSum += (watts[i] ?? 0);
  let best = windowSum / windowSec;
  for (let i = windowSec; i < n; i++) {
    windowSum += (watts[i] ?? 0) - (watts[i - windowSec] ?? 0);
    if (windowSum / windowSec > best) best = windowSum / windowSec;
  }
  return Math.round(best);
}

function computeCurve(watts: number[]): { label: string; power: number }[] {
  return DURATIONS
    .map(d => ({ label: d.label, power: rollingMax(watts, d.s) }))
    .filter((d): d is { label: string; power: number } => d.power !== null && d.power > 0);
}

function periodToClause(period: string): string {
  const intervals: Record<string, string> = {
    '30d': '30 days',
    '60d': '60 days',
    '90d': '90 days',
    '6m':  '180 days',
    '1y':  '365 days',
  };
  if (intervals[period]) return `AND a.start_date >= NOW() - INTERVAL '${intervals[period]}'`;
  return '';
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const compare = req.nextUrl.searchParams.get('compare') ?? 'none';

  const client = await pool.connect();
  try {
    const [streamRes, profile] = await Promise.all([
      client.query('SELECT watts FROM activity_streams WHERE activity_id = $1', [id]),
      getProfile(),
    ]);

    const watts: number[] | null = streamRes.rows[0]?.watts ?? null;
    const activityCurve = watts ? computeCurve(watts) : [];
    const ftp = effectiveFtp(profile);

    if (compare === 'none') {
      return Response.json({ activity: activityCurve, comparison: null, ftp });
    }

    const clause = periodToClause(compare);
    const compRes = await client.query(`
      SELECT s.watts
      FROM activities a
      JOIN activity_streams s ON s.activity_id = a.id
      WHERE a.sport_type = ANY($1::text[])
        AND s.watts IS NOT NULL
        AND a.id != $2
        ${clause}
      ORDER BY a.start_date DESC
      LIMIT 60
    `, [CYCLING_SPORTS, id]);

    const bestByLabel: Record<string, number> = {};
    for (const row of compRes.rows) {
      for (const { label, power } of computeCurve(row.watts)) {
        if (!bestByLabel[label] || power > bestByLabel[label]) {
          bestByLabel[label] = power;
        }
      }
    }

    const comparison = DURATIONS
      .filter(d => bestByLabel[d.label] != null)
      .map(d => ({ label: d.label, power: bestByLabel[d.label] }));

    return Response.json({ activity: activityCurve, comparison: comparison.length ? comparison : null, ftp });
  } catch (err) {
    console.error('Activity power curve error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
