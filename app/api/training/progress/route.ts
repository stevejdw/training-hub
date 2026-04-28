import pool from '@/lib/db';
import { NextRequest } from 'next/server';
import { getProfile } from '@/lib/profile';
import { SPORT_FILTERS, CYCLING_TYPES, SportFilter } from '@/lib/sport-types';

export const runtime = 'nodejs';

type Period = 'wtd' | 'mtd' | 'ytd';
type Metric = 'time' | 'km';

interface DayPoint { date: string; value: number; cum: number }

/** Returns day-by-day cumulative progress for the current period and the
 *  same-length prior period, filtered to selected sport types.
 *
 *  Query params:
 *    period   = wtd | mtd | ytd                     (default wtd)
 *    metric   = time | km                            (default time, hours)
 *    filters  = comma-separated SportFilter labels   (default All)
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const period   = (sp.get('period') ?? 'wtd') as Period;
  const metric   = (sp.get('metric') ?? 'time') as Metric;
  const filters  = sp.get('filters') ?? 'All';

  const labels = filters.split(',').map(s => s.trim()) as SportFilter[];
  const types: string[] = [];
  for (const lbl of labels) {
    if (lbl === 'All' || !SPORT_FILTERS[lbl]) continue;
    types.push(...SPORT_FILTERS[lbl]);
  }
  const sportTypes = types.length > 0 ? types : CYCLING_TYPES;

  const profile = await getProfile();
  const tz = profile.timezone || 'Australia/Sydney';

  const client = await pool.connect();
  try {
    // Compute current and prior period start/end (inclusive) in the user's TZ
    const today = (await client.query(
      `SELECT (NOW() AT TIME ZONE $1)::date AS d`, [tz]
    )).rows[0].d as string;

    const r = await client.query(
      `WITH bounds AS (
        SELECT $1::date AS today
      ),
      rng AS (
        SELECT
          CASE $2::text
            WHEN 'wtd' THEN today - ((EXTRACT(DOW FROM today)::int + 6) % 7)::int
            WHEN 'mtd' THEN date_trunc('month', today)::date
            WHEN 'ytd' THEN date_trunc('year',  today)::date
          END AS cur_start,
          today AS cur_end
        FROM bounds
      ),
      rng2 AS (
        SELECT
          cur_start,
          cur_end,
          (cur_end - cur_start) AS len_days
        FROM rng
      ),
      prior AS (
        SELECT
          CASE $2::text
            WHEN 'wtd' THEN cur_start - INTERVAL '7 days'
            WHEN 'mtd' THEN (date_trunc('month', cur_start - INTERVAL '1 day'))::date
            WHEN 'ytd' THEN (date_trunc('year',  cur_start - INTERVAL '1 day'))::date
          END::date AS prior_start,
          CASE $2::text
            WHEN 'wtd' THEN (cur_start - INTERVAL '1 day')::date
            WHEN 'mtd' THEN ((date_trunc('month', cur_start - INTERVAL '1 day')) + (cur_end - cur_start) * INTERVAL '1 day')::date
            WHEN 'ytd' THEN ((date_trunc('year',  cur_start - INTERVAL '1 day')) + (cur_end - cur_start) * INTERVAL '1 day')::date
          END::date AS prior_end
        FROM rng2
      )
      SELECT (SELECT cur_start::text FROM rng2) AS cur_start,
             (SELECT cur_end::text   FROM rng2) AS cur_end,
             (SELECT prior_start::text FROM prior) AS prior_start,
             (SELECT prior_end::text   FROM prior) AS prior_end`,
      [today, period]
    );
    const { cur_start, cur_end, prior_start, prior_end } = r.rows[0];

    async function bucketise(start: string, end: string): Promise<DayPoint[]> {
      const q = await client.query(
        `WITH days AS (
           SELECT generate_series($1::date, $2::date, INTERVAL '1 day')::date AS d
         ),
         daily AS (
           SELECT (start_date AT TIME ZONE $3)::date AS d,
                  SUM(CASE WHEN $4 = 'time' THEN moving_time::float / 3600.0
                            WHEN $4 = 'km'   THEN distance::float / 1000.0
                            ELSE 0 END) AS v
           FROM activities
           WHERE sport_type = ANY($5::text[])
             AND (start_date AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date
           GROUP BY 1
         )
         SELECT days.d::text AS date, COALESCE(daily.v, 0)::float AS value
         FROM days LEFT JOIN daily USING (d)
         ORDER BY days.d`,
        [start, end, tz, metric, sportTypes]
      );
      let cum = 0;
      return q.rows.map(row => {
        cum += Number(row.value);
        return { date: row.date, value: Number(row.value), cum: Math.round(cum * 100) / 100 };
      });
    }

    const [current, prior] = await Promise.all([
      bucketise(cur_start, cur_end),
      bucketise(prior_start, prior_end),
    ]);

    const curTotal   = current.length ? current[current.length - 1].cum : 0;
    const priorTotal = prior.length   ? prior[prior.length - 1].cum     : 0;

    return Response.json({
      period, metric, filters,
      current: { start: cur_start, end: cur_end, total: curTotal, points: current },
      prior:   { start: prior_start, end: prior_end, total: priorTotal, points: prior },
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
