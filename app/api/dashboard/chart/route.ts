import pool from '@/lib/db';
import { SPORT_FILTERS, CYCLING_TYPES, SportFilter } from '@/lib/sport-types';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

type Period = 'week' | 'month' | 'year';

interface TypeData {
  activities: number;
  km: number;
  hours: number;
  tss: number;
  elevation: number;
}

interface BarRow {
  label: string;
  date: string;
  activities: number;
  km: number;
  hours: number;
  tss: number;
  elevation: number;
  byType: Record<string, TypeData>;
}

const ZERO: TypeData = { activities: 0, km: 0, hours: 0, tss: 0, elevation: 0 };
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

function sumTypeData(byType: Record<string, TypeData>): TypeData {
  return Object.values(byType).reduce(
    (acc, t) => ({
      activities: acc.activities + t.activities,
      km:        +(acc.km    + t.km).toFixed(1),
      hours:     +(acc.hours + t.hours).toFixed(1),
      tss:        acc.tss       + t.tss,
      elevation:  acc.elevation + t.elevation,
    }),
    { ...ZERO }
  );
}

function buildBars(period: Period, start: Date, end: Date, rawRows: Record<string, unknown>[]): BarRow[] {
  // Group raw rows by period key, then by sport type
  const byKey = new Map<string, Record<string, TypeData>>();
  for (const r of rawRows) {
    const key  = String(r.key);
    const type = String(r.sport_type);
    if (!byKey.has(key)) byKey.set(key, {});
    byKey.get(key)![type] = {
      activities: Number(r.activities) || 0,
      km:         Number(r.km)         || 0,
      hours:      Number(r.hours)      || 0,
      tss:        Number(r.tss)        || 0,
      elevation:  Number(r.elevation)  || 0,
    };
  }

  const rows: BarRow[] = [];

  if (period === 'week') {
    for (let i = 0; i < 7; i++) {
      const dt     = new Date(start.getTime() + i * 86400000);
      const key    = isoDate(dt);
      const byType = byKey.get(key) ?? {};
      rows.push({ label: DAY_LABELS[i], date: key, ...sumTypeData(byType), byType });
    }
    return rows;
  }

  if (period === 'month') {
    const daysInMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    const numWeeks = Math.ceil(daysInMonth / 7);
    for (let w = 1; w <= numWeeks; w++) {
      const key    = String(w);
      const byType = byKey.get(key) ?? {};
      rows.push({ label: `W${w}`, date: key, ...sumTypeData(byType), byType });
    }
    return rows;
  }

  // year
  const yr = start.getUTCFullYear();
  for (let i = 0; i < 12; i++) {
    const key    = `${yr}-${String(i + 1).padStart(2, '0')}`;
    const byType = byKey.get(key) ?? {};
    rows.push({ label: MONTH_LABELS[i], date: key, ...sumTypeData(byType), byType });
  }
  return rows;
}

export async function GET(req: NextRequest) {
  try {
    const sp           = req.nextUrl.searchParams;
    const period       = (sp.get('period') ?? 'week') as Period;
    const offset       = parseInt(sp.get('offset') ?? '0', 10);
    const filtersParam = sp.get('filters') ?? 'All';

    const selectedLabels = filtersParam.split(',').map(s => s.trim()) as SportFilter[];
    const types: string[] = [];
    for (const label of selectedLabels) {
      if (label === 'All' || !SPORT_FILTERS[label]) continue;
      types.push(...SPORT_FILTERS[label]);
    }
    const activeSportTypes = types.length > 0 ? types : CYCLING_TYPES;

    const { start, end } = getPeriodRange(period, offset);
    const startStr = isoDate(start);
    const endStr   = isoDate(end);

    const groupExpr =
      period === 'week'  ? `TO_CHAR(start_date AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD')` :
      period === 'month' ? `CEIL(EXTRACT(DAY FROM start_date AT TIME ZONE 'Australia/Sydney') / 7.0)::int::text` :
                           `TO_CHAR(start_date AT TIME ZONE 'Australia/Sydney', 'YYYY-MM')`;

    const client = await pool.connect();
    try {
      const res = await client.query(`
        SELECT
          ${groupExpr}                                               AS key,
          sport_type,
          COUNT(*)::int                                              AS activities,
          ROUND(SUM(distance)::numeric         / 1000.0, 1)         AS km,
          ROUND(SUM(moving_time)::numeric      / 3600.0, 1)         AS hours,
          ROUND(SUM(COALESCE(tss, 0))::numeric, 0)::int             AS tss,
          ROUND(SUM(total_elevation_gain)::numeric, 0)::int         AS elevation
        FROM activities
        WHERE (start_date AT TIME ZONE 'Australia/Sydney')::date >= $1
          AND (start_date AT TIME ZONE 'Australia/Sydney')::date <  $2
          AND sport_type = ANY($3::text[])
        GROUP BY key, sport_type
        ORDER BY key
      `, [startStr, endStr, activeSportTypes]);

      const bars = buildBars(period, start, end, res.rows);

      const summary = bars.reduce(
        (acc, b) => ({
          activities: acc.activities + (Number(b.activities) || 0),
          km:        +(acc.km    + (Number(b.km)    || 0)).toFixed(1),
          hours:     +(acc.hours + (Number(b.hours) || 0)).toFixed(1),
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
