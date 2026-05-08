import pool from '@/lib/db';
import { getProfile, effectiveFtp } from '@/lib/profile';
import { NextRequest } from 'next/server';
import { CYCLING_TYPES } from '@/lib/sport-types';

export type PeriodKey = string;

function periodToClause(period: PeriodKey): string {
  if (period.startsWith('y:')) {
    const year = parseInt(period.slice(2), 10);
    return `AND EXTRACT(YEAR FROM a.start_date AT TIME ZONE 'Australia/Sydney') = ${year}`;
  }
  const intervals: Record<string, string> = {
    '7d':  '7 days',
    '30d': '30 days',
    '60d': '60 days',
    '90d': '90 days',
    '6m':  '180 days',
    '1y':  '365 days',
    '4w':  '28 days',
    '6w':  '42 days',
    '3m':  '90 days',
    '12m': '365 days',
  };
  if (intervals[period]) return `AND a.start_date >= NOW() - INTERVAL '${intervals[period]}'`;
  return '';
}

// Durations for the power curve, matching the chart's expected label ordering
const CURVE_DURATIONS = [
  { label: '1s',  seconds: 1    },
  { label: '5s',  seconds: 5    },
  { label: '15s', seconds: 15   },
  { label: '30s', seconds: 30   },
  { label: '1m',  seconds: 60   },
  { label: '2m',  seconds: 120  },
  { label: '5m',  seconds: 300  },
  { label: '10m', seconds: 600  },
  { label: '20m', seconds: 1200 },
  { label: '30m', seconds: 1800 },
  { label: '45m', seconds: 2700 },
  { label: '60m', seconds: 3600 },
  { label: '75m', seconds: 4500 },
  { label: '90m', seconds: 5400 },
  { label: '2h',  seconds: 7200 },
];

async function fetchCurve(period: PeriodKey) {
  const clause = periodToClause(period);
  const minSeconds = 1; // always include 1s peak

  const durations = CURVE_DURATIONS.filter(d => d.seconds > 0);

  const windowExprs = durations
    .map(d => `SUM(COALESCE(w,0)::numeric) OVER (ORDER BY idx ROWS BETWEEN ${d.seconds - 1} PRECEDING AND CURRENT ROW) AS ws${d.seconds}`)
    .join(',\n              ');

  const lateralExprs = durations
    .map(d => `MAX(CASE WHEN idx >= ${d.seconds} THEN ws${d.seconds} END) AS max_ws${d.seconds}`)
    .join(',\n            ');

  const selectExprs = durations
    .map(d => `ROUND(MAX(bp.max_ws${d.seconds}) / ${d.seconds}.0)::int AS best_${d.seconds}`)
    .join(',\n          ');

  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT
        ${selectExprs}
      FROM activities a
      JOIN activity_streams s ON s.activity_id = a.id
      CROSS JOIN LATERAL (
        SELECT
          ${lateralExprs}
        FROM (
          SELECT
            idx,
            ${windowExprs}
          FROM unnest(s.watts) WITH ORDINALITY AS t(w, idx)
        ) sub
      ) bp
      WHERE a.average_watts IS NOT NULL
        AND a.sport_type = ANY($1::text[])
        AND array_length(s.watts, 1) >= ${minSeconds}
        ${clause}
    `, [CYCLING_TYPES]);

    const row = res.rows[0] ?? {};
    const points: { label: string; power: number }[] = [];
    for (const d of durations) {
      const val = Number(row[`best_${d.seconds}`]);
      if (Number.isFinite(val) && val > 0) {
        points.push({ label: d.label, power: val });
      }
    }

    // For durations longer than any single ride (2h+), fall back to NP/AP across rides
    // that span the full duration (e.g., a 2+ hour ride's NP is a good proxy for 2h best power)
    if (!points.some(p => p.label === '2h')) {
      const longRes = await client.query(`
        SELECT
          ROUND(MAX(COALESCE(normalized_power, weighted_average_watts, average_watts))::numeric) AS best_7200
        FROM activities a
        WHERE a.average_watts IS NOT NULL
          AND a.sport_type = ANY($1::text[])
          AND a.moving_time >= 7200
          ${clause}
      `, [CYCLING_TYPES]);
      if (longRes.rows[0]?.best_7200 != null) {
        points.push({ label: '2h', power: Number(longRes.rows[0].best_7200) });
      }

      const longRes3h = await client.query(`
        SELECT
          ROUND(MAX(COALESCE(normalized_power, weighted_average_watts, average_watts))::numeric) AS best_10800
        FROM activities a
        WHERE a.average_watts IS NOT NULL
          AND a.sport_type = ANY($1::text[])
          AND a.moving_time >= 10800
          ${clause}
      `, [CYCLING_TYPES]);
      if (longRes3h.rows[0]?.best_10800 != null) {
        points.push({ label: '3h+', power: Number(longRes3h.rows[0].best_10800) });
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
