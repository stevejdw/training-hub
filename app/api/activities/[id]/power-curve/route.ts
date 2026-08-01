import pool from '@/lib/db';
import { getProfile, effectiveFtp } from '@/lib/profile';
import { ensureBestPowerTableForRead } from '@/lib/best-power';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

const DURATIONS = [
  { label: '1s',  s: 1     },
  { label: '5s',  s: 5     },
  { label: '30s', s: 30    },
  { label: '1m',  s: 60    },
  { label: '5m',  s: 300   },
  { label: '10m', s: 600   },
  { label: '20m', s: 1200  },
  { label: '30m', s: 1800  },
  { label: '60m', s: 3600  },
  // No 75m point: it is not a tracked best_power_efforts interval, so neither
  // the activity curve nor the comparison curve can source it without pulling
  // the raw watts array back out of the database.
  { label: '90m', s: 5400  },
  { label: '2h',  s: 7200  },
  { label: '3h',  s: 10800 },
  { label: '4h',  s: 14400 },
  { label: '5h',  s: 18000 },
  { label: '6h',  s: 21600 },
  { label: '8h',  s: 28800 },
  { label: '10h', s: 36000 },
  { label: '12h', s: 43200 },
  { label: '15h', s: 54000 },
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
  if (intervals[period]) return `AND bpe.start_date >= NOW() - INTERVAL '${intervals[period]}'`;
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
    await ensureBestPowerTableForRead();

    // The activity's own curve comes from the precomputed per-activity bests.
    // computeBestPower() and rollingMax() maximise the same window sum before
    // rounding, so these are the identical numbers the stream would produce —
    // for ~1 KB of scalars instead of the full 1 Hz watts array.
    const [effortRes, profile] = await Promise.all([
      client.query<{ seconds: number; best_watts: string | null }>(
        // No best_watts filter: a row with NULL best_watts is the marker that
        // this activity has been processed and simply has no usable power, and
        // must still count as warmed so we do not fall back to the stream.
        `SELECT seconds, best_watts
           FROM best_power_efforts
          WHERE activity_id = $1`,
        [id],
      ),
      getProfile(),
    ]);

    let activityCurve: { label: string; power: number }[];
    if (effortRes.rows.length > 0) {
      const bySeconds = new Map<number, number>();
      for (const row of effortRes.rows) {
        if (row.best_watts == null) continue;
        bySeconds.set(Number(row.seconds), Math.round(Number(row.best_watts)));
      }
      activityCurve = DURATIONS
        .filter(d => (bySeconds.get(d.s) ?? 0) > 0)
        .map(d => ({ label: d.label, power: bySeconds.get(d.s)! }));
    } else {
      // Not warmed into best_power_efforts yet (freshly synced, or a ride whose
      // power stream yields no non-null bests). Fall back to the stream so the
      // curve is still correct rather than empty.
      const streamRes = await client.query(
        'SELECT watts FROM activity_streams WHERE activity_id = $1',
        [id],
      );
      const watts: number[] | null = streamRes.rows[0]?.watts ?? null;
      activityCurve = watts ? computeCurve(watts) : [];
    }

    const ftp = effectiveFtp(profile);

    if (compare === 'none') {
      return Response.json({ activity: activityCurve, comparison: null, ftp });
    }

    // Comparison curve from precomputed best_power_efforts — a few dozen
    // scalar rows instead of raw watts arrays for every ride in the period.
    const clause = periodToClause(compare);
    const compRes = await client.query<{ seconds: number; power: string }>(`
      SELECT bpe.seconds, MAX(bpe.best_watts) AS power
      FROM best_power_efforts bpe
      WHERE bpe.sport_type = ANY($1::text[])
        AND bpe.activity_id != $2
        AND bpe.best_watts IS NOT NULL
        ${clause}
      GROUP BY bpe.seconds
    `, [CYCLING_SPORTS, id]);

    const bestBySeconds = new Map<number, number>();
    for (const row of compRes.rows) {
      bestBySeconds.set(Number(row.seconds), Math.round(Number(row.power)));
    }

    const comparison = DURATIONS
      .filter(d => (bestBySeconds.get(d.s) ?? 0) > 0)
      .map(d => ({ label: d.label, power: bestBySeconds.get(d.s)! }));

    return Response.json({ activity: activityCurve, comparison: comparison.length ? comparison : null, ftp });
  } catch (err) {
    console.error('Activity power curve error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
