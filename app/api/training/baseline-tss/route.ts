import pool from '@/lib/db';
import { getProfile } from '@/lib/profile';

export const runtime = 'nodejs';

const CYCLING_TYPES = ['Ride', 'VirtualRide', 'GravelRide', 'EBikeRide', 'MountainBikeRide', 'EMountainBikeRide'];

export interface BaselineTssResponse {
  suggested: number;
  source: 'configured' | '4-week-avg' | 'default';
  detail: string;
}

/**
 * Returns a suggested weekly TSS target for a new training plan.
 *  - If profile.tss_plan.starting_tss is set, use that.
 *  - Otherwise, average the user's weekly TSS over the last 4 completed weeks.
 *  - Otherwise, fall back to a sensible default (300).
 */
export async function GET() {
  try {
    const profile = await getProfile();
    if (profile.tss_plan?.starting_tss && profile.tss_plan.starting_tss > 0) {
      return Response.json({
        suggested: Math.round(profile.tss_plan.starting_tss),
        source: 'configured',
        detail: 'From your TSS plan settings',
      } satisfies BaselineTssResponse);
    }

    const tz = profile.timezone || 'Australia/Sydney';
    const client = await pool.connect();
    try {
      // Sum TSS per ISO week over the last 4 completed weeks (Mon-based).
      const res = await client.query<{ week_total: string }>(
        `
        WITH last4 AS (
          SELECT (date_trunc('week', (start_date AT TIME ZONE $1))::date) AS week_start,
                 SUM(COALESCE(tss, hrss, 0))::float AS week_total
          FROM activities
          WHERE sport_type = ANY($2::text[])
            AND (start_date AT TIME ZONE $1)::date
                BETWEEN ((NOW() AT TIME ZONE $1)::date - INTERVAL '28 days')
                    AND ((NOW() AT TIME ZONE $1)::date - INTERVAL '1 day')
          GROUP BY 1
        )
        SELECT week_total FROM last4 ORDER BY week_start DESC LIMIT 4
      `,
        [tz, CYCLING_TYPES],
      );

      if (res.rows.length > 0) {
        const totals = res.rows.map(r => Number(r.week_total));
        const avg = totals.reduce((s, n) => s + n, 0) / totals.length;
        return Response.json({
          suggested: Math.max(0, Math.round(avg)),
          source: '4-week-avg',
          detail: `Average of last ${totals.length} week${totals.length === 1 ? '' : 's'} of riding`,
        } satisfies BaselineTssResponse);
      }

      return Response.json({
        suggested: 300,
        source: 'default',
        detail: 'No recent rides — using 300 TSS as a starting point',
      } satisfies BaselineTssResponse);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Baseline TSS error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
