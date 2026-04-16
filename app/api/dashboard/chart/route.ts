import pool from '@/lib/db';
import { SPORT_FILTERS, SportFilter } from '@/lib/sport-types';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

type Period = 'week' | 'month' | 'year';

interface BarRow {
  label: string;
  date: string;
  activities: number;
  km: number;
  hours: number;
  tss: number;
  elevation: number;
}

const ZERO: Omit<BarRow, 'label' | 'date'> = { activities: 0, km: 0, hours: 0, tss: 0, elevation: 0 };
const DAY_LABELS   = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function sydneyNow() {
  const d = new Date(Date.now() + 10 * 60 * 60 * 1000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay() };
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function getPeriodRange(period: Period, offset: number): { start: Date; end: Date } {
  const { y, m, d, dow } = sydneyNow();

  if (period === 'week') {
    const daysFromMon = dow === 0 ? 6 : dow - 1;
    const mon = new Date(Date.UTC(y, m, d - daysFromMon));
    const start = new Date(mon.getTime() + offset * 7 * 86400000);
    const end   = new Date(start.getTime() + 7 * 86400000);
    return { start, end };
  }
  if (period === 'month') {
    const totalMonths = y * 12 + m + offset;
    const my = Math.floor(totalMonths / 12);
    const mm = ((totalMonths % 12) + 12) % 12;
    return {
      start: new Date(Date.UTC(my, mm, 1)),
      end:   new Date(Date.UTC(my, mm + 1, 1)),
    };
  }
  const yr = y + offset;
  return {
    start: new Date(Date.UTC(yr, 0, 1)),
    end:   new Date(Date.UTC(yr + 1, 0, 1)),
  };
}

function periodLabel(period: Period, start: Date): string {
  if (period === 'week') {
    const end = new Date(start.getTime() + 6 * 86400000);
    const s = start.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const e = end.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    return `${s} – ${e}`;
  }
  if (period === 'month') {
    return start.toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  return String(start.getUTCFullYear());
}


function buildBars(period: Period, start: Date, end: Date, rawRows: Record<string, unknown>[]): BarRow[] {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const r of rawRows) byKey.set(String(r.key), r);

  const rows: BarRow[] = [];

  if (period === 'week') {
    for (let i = 0; i < 7; i++) {
      const dt  = new Date(start.getTime() + i * 86400000);
      const key = isoDate(dt);
      const r   = byKey.get(key);
      rows.push({ label: DAY_LABELS[i], date: key, ...ZERO, ...(r ?? {}) as Partial<BarRow> });
    }
    return rows;
  }

  if (period === 'month') {
    // Keys are 1–5 (ceil of day/7), matching the SQL CEIL(DAY/7) grouping
    const daysInMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    const numWeeks = Math.ceil(daysInMonth / 7);
    for (let w = 1; w <= numWeeks; w++) {
      const key = String(w);
      const r   = byKey.get(key);
      const dayStart = (w - 1) * 7 + 1;
      const dayEnd   = Math.min(w * 7, daysInMonth);
      rows.push({ label: `${dayStart}–${dayEnd}`, date: key, ...ZERO, ...(r ?? {}) as Partial<BarRow> });
    }
    return rows;
  }

  // year — 12 month buckets
  const yr = start.getUTCFullYear();
  for (let i = 0; i < 12; i++) {
    const key = `${yr}-${String(i + 1).padStart(2, '0')}`;
    const r   = byKey.get(key);
    rows.push({ label: MONTH_LABELS[i], date: key, ...ZERO, ...(r ?? {}) as Partial<BarRow> });
  }
  return rows;
}

export async function GET(req: NextRequest) {
  try {
    const sp          = req.nextUrl.searchParams;
    const period      = (sp.get('period') ?? 'week') as Period;
    const offset      = parseInt(sp.get('offset') ?? '0', 10);
    const filtersParam = sp.get('filters') ?? 'All';

    const selectedLabels = filtersParam.split(',').map(s => s.trim()) as SportFilter[];
    const types: string[] = [];
    for (const label of selectedLabels) {
      if (label === 'All' || !SPORT_FILTERS[label]) continue;
      types.push(...SPORT_FILTERS[label]);
    }
    const hasTypes = types.length > 0;

    const { start, end } = getPeriodRange(period, offset);
    const startStr = isoDate(start);
    const endStr   = isoDate(end);

    // Group-by expression per period
    // For month: bucket by week-of-month (1–5) using day number
    const groupExpr =
      period === 'week'  ? `TO_CHAR(start_date AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD')` :
      period === 'month' ? `CEIL(EXTRACT(DAY FROM start_date AT TIME ZONE 'Australia/Sydney') / 7.0)::int::text` :
                           `TO_CHAR(start_date AT TIME ZONE 'Australia/Sydney', 'YYYY-MM')`;

    const typeClause = hasTypes ? 'AND sport_type = ANY($3::text[])' : '';
    const params: unknown[] = [startStr, endStr, ...(hasTypes ? [types] : [])];

    const client = await pool.connect();
    try {
      const res = await client.query(`
        SELECT
          ${groupExpr} AS key,
          COUNT(*)::int                                           AS activities,
          ROUND(SUM(distance)::numeric         / 1000.0, 1)      AS km,
          ROUND(SUM(moving_time)::numeric      / 3600.0, 1)      AS hours,
          ROUND(SUM(COALESCE(tss, 0))::numeric, 0)::int          AS tss,
          ROUND(SUM(total_elevation_gain)::numeric, 0)::int      AS elevation
        FROM activities
        WHERE (start_date AT TIME ZONE 'Australia/Sydney')::date >= $1
          AND (start_date AT TIME ZONE 'Australia/Sydney')::date <  $2
          ${typeClause}
        GROUP BY key
        ORDER BY key
      `, params);

      const bars = buildBars(period, start, end, res.rows);

      const summary = bars.reduce(
        (acc, b) => ({
          activities: acc.activities + (Number(b.activities) || 0),
          km:         +(acc.km    + (Number(b.km)    || 0)).toFixed(1),
          hours:      +(acc.hours + (Number(b.hours) || 0)).toFixed(1),
          tss:        acc.tss       + (Number(b.tss)       || 0),
          elevation:  acc.elevation + (Number(b.elevation) || 0),
        }),
        { activities: 0, km: 0, hours: 0, tss: 0, elevation: 0 }
      );

      return Response.json({
        label:        periodLabel(period, start),
        canGoForward: offset < 0,
        summary,
        bars,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Dashboard chart API error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
