import pool from '@/lib/db';
import { SPORT_FILTERS, SportFilter } from '@/lib/sport-types';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

type Period = 'week' | 'month' | 'year';

function sydneyNow() {
  const d = new Date(Date.now() + 10 * 60 * 60 * 1000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay() };
}

function getPeriodRange(period: Period, offset: number) {
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
    const mm = totalMonths % 12;
    return {
      start: new Date(Date.UTC(my, mm, 1)),
      end:   new Date(Date.UTC(my, mm + 1, 1)),
    };
  }
  // year
  const yr = y + offset;
  return { start: new Date(Date.UTC(yr, 0, 1)), end: new Date(Date.UTC(yr + 1, 0, 1)) };
}

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function periodLabel(period: Period, start: Date, end: Date, offset: number): string {
  if (period === 'week') {
    const s = start.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const e = new Date(end.getTime() - 86400000)
      .toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    return `${s} – ${e}`;
  }
  if (period === 'month') {
    return start.toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  return String(start.getUTCFullYear());
}

interface BarRow { label: string; date: string; activities: number; km: number; hours: number; tss: number; elevation: number; }
const ZERO = { activities: 0, km: 0, hours: 0, tss: 0, elevation: 0 };

function fillBars(period: Period, start: Date, rawRows: Record<string, unknown>[]): BarRow[] {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const r of rawRows) byKey.set(String(r.key), r);

  const rows = [];

  if (period === 'week') {
    for (let i = 0; i < 7; i++) {
      const dt = new Date(start.getTime() + i * 86400000);
      const key = isoDate(dt);
      const r = byKey.get(key);
      rows.push({ label: DAY_LABELS[i], date: key, ...ZERO, ...(r as Partial<BarRow> ?? {}) });
    }
    return rows;
  }

  if (period === 'month') {
    let cur = new Date(start);
    let weekNum = 1;
    const monthEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    while (cur < monthEnd) {
      const key = isoDate(cur);
      const r = byKey.get(key);
      rows.push({ label: `W${weekNum}`, date: key, ...ZERO, ...(r as Partial<BarRow> ?? {}) });
      cur = new Date(cur.getTime() + 7 * 86400000);
      weekNum++;
    }
    return rows;
  }

  const yr = start.getUTCFullYear();
  for (let i = 0; i < 12; i++) {
    const key = `${yr}-${String(i + 1).padStart(2, '0')}`;
    const r = byKey.get(key);
    rows.push({ label: MONTH_LABELS[i], date: key, ...ZERO, ...(r as Partial<BarRow> ?? {}) });
  }
  return rows;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const period = (sp.get('period') ?? 'week') as Period;
  const offset = parseInt(sp.get('offset') ?? '0', 10);
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

  const client = await pool.connect();
  try {
    // GROUP BY key differs per period
    const groupExpr =
      period === 'week'  ? `TO_CHAR(start_date AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD')` :
      period === 'month' ? `TO_CHAR(date_trunc('week', start_date AT TIME ZONE 'Australia/Sydney'), 'YYYY-MM-DD')` :
                           `TO_CHAR(start_date AT TIME ZONE 'Australia/Sydney', 'YYYY-MM')`;

    const baseWhere = `
      (start_date AT TIME ZONE 'Australia/Sydney')::date >= $1
      AND (start_date AT TIME ZONE 'Australia/Sydney')::date < $2
      ${hasTypes ? 'AND sport_type = ANY($3::text[])' : ''}
    `;
    const params: unknown[] = [startStr, endStr, ...(hasTypes ? [types] : [])];

    const res = await client.query(`
      SELECT
        ${groupExpr} AS key,
        COUNT(*)::int AS activities,
        ROUND(SUM(distance)::numeric / 1000.0, 1)::float AS km,
        ROUND(SUM(moving_time)::numeric / 3600.0, 2)::float AS hours,
        ROUND(SUM(COALESCE(tss, 0))::numeric, 0)::int AS tss,
        ROUND(SUM(total_elevation_gain)::numeric, 0)::int AS elevation
      FROM activities
      WHERE ${baseWhere}
      GROUP BY key
      ORDER BY key
    `, params);

    const bars = fillBars(period, start, res.rows);

    const summary = bars.reduce(
      (acc, b) => ({
        activities: acc.activities + (Number(b.activities) || 0),
        km:         +(acc.km + (Number(b.km) || 0)).toFixed(1),
        hours:      +(acc.hours + (Number(b.hours) || 0)).toFixed(1),
        tss:        acc.tss + (Number(b.tss) || 0),
        elevation:  acc.elevation + (Number(b.elevation) || 0),
      }),
      { activities: 0, km: 0, hours: 0, tss: 0, elevation: 0 }
    );

    return Response.json({
      label: periodLabel(period, start, end, offset),
      canGoForward: offset < 0,
      summary,
      bars,
    });
  } finally {
    client.release();
  }
}
