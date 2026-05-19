import pool from '@/lib/db';
import { NextRequest } from 'next/server';
import { getProfile } from '@/lib/profile';
import { SPORT_FILTERS, CYCLING_TYPES, SportFilter } from '@/lib/sport-types';

export const runtime = 'nodejs';

type Period = 'wtd' | 'mtd' | 'ytd';
type Metric = 'time' | 'km' | 'tss' | 'elevation' | 'activities';

interface DayPoint { date: string; value: number; cum: number }

/** Returns day-by-day cumulative progress for the requested period (with offset
 *  for back-navigation) and the period immediately before it.
 *
 *  Query params:
 *    period   = wtd | mtd | ytd                     (default wtd)
 *    metric   = time | km                            (default time, hours)
 *    filters  = comma-separated SportFilter labels   (default All)
 *    offset   = integer ≤ 0 — how many periods back  (default 0 = current)
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const period   = (sp.get('period') ?? 'wtd') as Period;
  const metric   = (sp.get('metric') ?? 'time') as Metric;
  const filters  = sp.get('filters') ?? 'All';
  const offset   = Math.min(0, parseInt(sp.get('offset') ?? '0', 10));

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
    // Get today's date in the user's timezone
    const today = (await client.query(
      `SELECT ((NOW() AT TIME ZONE $1)::date)::text AS d`, [tz]
    )).rows[0].d as string;

    // ── Compute period boundaries in TypeScript ───────────────────────
    function addDays(d: string, n: number): string {
      const [yr, mo, dy] = d.split('-').map(Number);
      const dt = new Date(Date.UTC(yr, mo - 1, dy + n));
      return dt.toISOString().slice(0, 10);
    }

    /** Day-of-week where 0 = Monday, 6 = Sunday */
    function dowMon(d: string): number {
      const [yr, mo, dy] = d.split('-').map(Number);
      return (new Date(Date.UTC(yr, mo - 1, dy)).getUTCDay() + 6) % 7;
    }

    /** Last day of the month that contains `d`, offset by `n` months */
    function endOfMonthOffset(d: string, n: number): string {
      const [yr, mo] = d.split('-').map(Number);
      // Date.UTC(yr, mo + n, 0) → last day of month (mo + n - 1)
      return new Date(Date.UTC(yr, mo + n, 0)).toISOString().slice(0, 10);
    }

    /** First day of month offset by `n` months from the month of `d` */
    function monthStartOffset(d: string, n: number): string {
      const [yr, mo] = d.split('-').map(Number);
      return new Date(Date.UTC(yr, mo - 1 + n, 1)).toISOString().slice(0, 10);
    }

    /**
     * Returns the same day-of-month as `d` in the month that is `n` months
     * earlier.  If the target month doesn't have that many days (e.g. 31 in
     * February), it clamps to the last day of the target month.
     */
    function sameDayPrevMonth(d: string, n: number): string {
      const [yr, mo, dy] = d.split('-').map(Number);
      // Target month = mo - 1 - n  (0-indexed)
      const targetMonth = mo - 1 - n;
      const targetYear  = yr + Math.floor(targetMonth / 12);
      const tm          = ((targetMonth % 12) + 12) % 12;
      const lastDay     = new Date(Date.UTC(targetYear, tm + 1, 0)).getUTCDate();
      const clamped     = Math.min(dy, lastDay);
      return new Date(Date.UTC(targetYear, tm, clamped)).toISOString().slice(0, 10);
    }

    /**
     * Returns the same month-day as `d` but one year earlier.
     * If `d` is Feb 29 and the previous year is not a leap year, returns Feb 28.
     */
    function sameDayPrevYear(d: string): string {
      const [yr, mo, dy] = d.split('-').map(Number);
      const prevYear = yr - 1;
      const lastDay  = new Date(Date.UTC(prevYear, mo, 0)).getUTCDate(); // last day of target month
      const clamped  = Math.min(dy, lastDay);
      return new Date(Date.UTC(prevYear, mo - 1, clamped)).toISOString().slice(0, 10);
    }

    let cur_start: string, cur_end: string, prior_start: string, prior_end: string;

    if (period === 'wtd') {
      // Shift Monday of this week by `offset` weeks
      const thisMonday = addDays(today, -dowMon(today));
      cur_start = addDays(thisMonday, offset * 7);
      cur_end   = offset === 0 ? today : addDays(cur_start, 6);
      // Prior period: same relative portion (same day-of-week offset from its Monday)
      prior_start = addDays(cur_start, -7);
      prior_end   = offset === 0
        ? addDays(today, -7)           // same day-of-week as today, one week back
        : addDays(cur_start, -1);      // full prior week when navigating history

    } else if (period === 'mtd') {
      cur_start = monthStartOffset(today, offset);
      cur_end   = offset === 0 ? today : endOfMonthOffset(today, offset);
      // Prior period: same day-of-month as today, one month back
      prior_start = monthStartOffset(today, offset - 1);
      prior_end   = offset === 0
        ? sameDayPrevMonth(today, 1)   // same day-of-month, previous month
        : addDays(cur_start, -1);      // full prior month when navigating history

    } else { // ytd
      const curYear = parseInt(today.slice(0, 4)) + offset;
      cur_start   = `${curYear}-01-01`;
      cur_end     = offset === 0 ? today : `${curYear}-12-31`;
      // Prior period: same month-day, previous year
      prior_start = `${curYear - 1}-01-01`;
      prior_end   = offset === 0
        ? sameDayPrevYear(today)       // same month-day, previous year (handles Feb 29 → Feb 28)
        : addDays(cur_start, -1);      // full prior year when navigating history
    }

    // ── Fetch day-by-day buckets ───────────────────────────────────────
    async function bucketise(start: string, end: string): Promise<DayPoint[]> {
      const q = await client.query(
        `WITH days AS (
           SELECT generate_series($1::date, $2::date, INTERVAL '1 day')::date AS d
         ),
         daily AS (
           SELECT (start_date AT TIME ZONE $3)::date AS d,
                  SUM(CASE WHEN $4 = 'time'       THEN moving_time::float / 3600.0
                           WHEN $4 = 'km'         THEN distance::float / 1000.0
                           WHEN $4 = 'tss'        THEN COALESCE(tss, hrss, 0)::float
                           WHEN $4 = 'elevation'  THEN total_elevation_gain::float
                           WHEN $4 = 'activities' THEN 1::float
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
      period, metric, filters, offset,
      current: { start: cur_start, end: cur_end, total: curTotal, points: current },
      prior:   { start: prior_start, end: prior_end, total: priorTotal, points: prior },
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
