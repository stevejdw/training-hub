'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, Line, CartesianGrid,
} from 'recharts';
import { SPORT_FILTER_LABELS, CYCLING_TYPES, SportFilter, sportColor, sportLabel } from '@/lib/sport-types';
import ActivitiesList from './ActivitiesList';
import FeedPage from './FeedPage';
import ProfileEditor from './ProfileEditor';
import MobileTabBar from './MobileTabBar';

type Tab    = 'feed' | 'activities' | 'progress' | 'settings';
type Period = 'week' | 'month' | 'year';
type Metric = 'tss' | 'km' | 'hours' | 'activities';

interface TypeData {
  activities: number;
  km: number;
  hours: number;
  tss: number;
  elevation: number;
}

interface BarData {
  label: string;
  date: string;
  activities: number;
  km: number;
  hours: number;
  tss: number;
  elevation: number;
  byType: Record<string, TypeData>;
}

interface FlatBar extends BarData {
  [key: string]: unknown;
}

interface ChartResponse {
  label: string;
  canGoForward: boolean;
  summary: { activities: number; km: number; hours: number; tss: number; elevation: number };
  bars: BarData[];
}

interface DayPoint { date: string; value: number; cum: number }
interface ProgressResponse {
  current: { start: string; end: string; total: number; points: DayPoint[] };
  prior:   { start: string; end: string; total: number; points: DayPoint[] };
  fullPeriod: { start: string; end: string; points: DayPoint[] };
  priorFull: { start: string; end: string; points: DayPoint[] };
}

const TYPE_FILTERS = SPORT_FILTER_LABELS.filter(f => f !== 'All') as SportFilter[];

const METRIC_OPTS: { key: Metric; label: string; unit: string }[] = [
  { key: 'km',         label: 'Distance',  unit: 'km' },
  { key: 'hours',      label: 'Time',      unit: 'h'  },
  { key: 'tss',        label: 'TSS',       unit: ''   },
  { key: 'activities', label: 'Rides',     unit: ''   },
];

/** Map dashboard period/week/month/year → progress API period (wtd/mtd/ytd) */
function toProgressPeriod(p: Period): 'wtd' | 'mtd' | 'ytd' {
  if (p === 'week') return 'wtd';
  if (p === 'month') return 'mtd';
  return 'ytd';
}

/** Map dashboard metric → progress API metric */
function toProgressMetric(m: Metric): 'km' | 'time' | 'tss' | 'elevation' | 'activities' {
  if (m === 'hours') return 'time';
  return m;
}

const NAV: { key: Tab; label: string; icon: React.ReactNode }[] = [
  {
    key: 'feed', label: 'Feed',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h10M4 18h16" />
      </svg>
    ),
  },
  {
    key: 'activities', label: 'Activities',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    key: 'progress', label: 'Progress',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 17l6-6 4 4 8-8M14 7h7v7" />
      </svg>
    ),
  },
];

/** Returns the ISO date string (YYYY-MM-DD) for the start of the current
 *  period, accounting for the given offset, using UTC+10 (Sydney) math. */
function periodStart(period: Period, offset: number): string {
  // Use UTC+10 to approximate Sydney "today" without locale string parsing
  const nowMs = Date.now() + 10 * 3_600_000;
  const d = new Date(nowMs);
  // Work in UTC (which is now effectively UTC+10)
  if (period === 'week') {
    const dow = d.getUTCDay(); // 0=Sun … 6=Sat
    const toMonday = (dow === 0) ? 6 : dow - 1;
    d.setUTCDate(d.getUTCDate() - toMonday + offset * 7);
  } else if (period === 'month') {
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + offset);
  } else {
    d.setUTCMonth(0, 1);
    d.setUTCFullYear(d.getUTCFullYear() + offset);
  }
  return d.toISOString().slice(0, 10);
}

function StatCard({ label, value, href }: { label: string; value: string; href?: string }) {
  const inner = (
    <div className={`bg-gray-800 rounded-xl p-3 md:p-5 flex flex-col gap-0.5 md:gap-1 min-w-[80px] transition-colors ${href ? 'group-hover:bg-gray-700 cursor-pointer' : ''}`}>
      <span className="text-[10px] md:text-xs text-gray-500 uppercase tracking-wider">{label}</span>
      <span className="text-lg md:text-2xl font-bold text-white leading-tight">{value}</span>
      {href && <span className="text-[10px] md:text-xs text-orange-400 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">View →</span>}
    </div>
  );
  if (href) return <Link href={href} className="group">{inner}</Link>;
  return inner;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label, metric, unit }: any) {
  if (!active || !payload?.length) return null;
  const nonZero = (payload as { dataKey: string; value: number; fill: string }[])
    .filter(p => Number(p.value) > 0);
  const total = nonZero.reduce((s, p) => s + Number(p.value), 0);
  const fmt = (v: number) => {
    if (metric === 'km')    return v >= 100 ? Math.round(v).toString() : v.toFixed(1);
    if (metric === 'hours') return v >= 10  ? Math.round(v).toString() : v.toFixed(1);
    return Math.round(v).toString();
  };

  // Merge eBike + eMTB into a single line (they share the green colour).
  const merged: { fill: string; label: string; value: number }[] = [];
  const indexByLabel: Record<string, number> = {};
  for (const p of nonZero) {
    const type = p.dataKey.slice(metric.length + 1);
    const lbl  = (type === 'EBikeRide' || type === 'EMountainBikeRide')
      ? 'eBike / eMTB'
      : sportLabel(type);
    if (lbl in indexByLabel) {
      merged[indexByLabel[lbl]].value += Number(p.value);
    } else {
      indexByLabel[lbl] = merged.length;
      merged.push({ fill: p.fill, label: lbl, value: Number(p.value) });
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-gray-400 mb-1">{label}</p>
      {merged.map(m => (
        <p key={m.label} style={{ color: m.fill }} className="font-medium">
          {m.label}: {fmt(m.value)}{unit ? ` ${unit}` : ''}
        </p>
      ))}
      {merged.length > 1 && (
        <p className="text-white font-semibold border-t border-gray-700 mt-1 pt-1">
          Total: {fmt(total)}{unit ? ` ${unit}` : ''}
        </p>
      )}
    </div>
  );
}

const CHART_CACHE_KEY = (period: Period, offset: number, filters: string) =>
  `cache-chart-v2-${period}-${offset}-${filters}`;
const INITIAL_CHART_KEY = CHART_CACHE_KEY('week', 0, 'All');

function TrainingTab() {
  const [period, setPeriod]   = useState<Period>('week');
  const [offset, setOffset]   = useState(0);
  const [metric, setMetric]   = useState<Metric>('km');
  const [selected, setSelected] = useState<SportFilter[]>([]);
  const [progressData, setProgressData] = useState<ProgressResponse | null>(null);
  const [progressLoading, setProgressLoading] = useState(true);

  const swipeStartX = useRef<number | null>(null);
  const PERIOD_ORDER: Period[] = ['week', 'month', 'year'];

  function changePeriod(p: Period) { setPeriod(p); setOffset(0); }

  function handleStatSwipe(dir: 'left' | 'right') {
    const idx  = PERIOD_ORDER.indexOf(period);
    const next = dir === 'left'
      ? PERIOD_ORDER[Math.min(PERIOD_ORDER.length - 1, idx + 1)]
      : PERIOD_ORDER[Math.max(0, idx - 1)];
    if (next !== period) changePeriod(next);
  }

  function toggleFilter(f: SportFilter) {
    setSelected(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);
  }

  const filtersParam = selected.length > 0 ? selected.join(',') : 'All';

  // Fetch progress data (same API as the training progress tab)
  useEffect(() => {
    setProgressLoading(true);
    setProgressData(null);
    const progPeriod = toProgressPeriod(period);
    const progMetric = toProgressMetric(metric);
    fetch(`/api/training/progress?period=${progPeriod}&metric=${progMetric}&filters=${encodeURIComponent(filtersParam)}&offset=${offset}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setProgressData(null); }
        else { setProgressData(d); }
        setProgressLoading(false);
      })
      .catch(() => setProgressLoading(false));
  }, [period, metric, filtersParam, offset]);

  const m = METRIC_OPTS.find(x => x.key === metric)!;
  const curTotal   = progressData?.current?.total ?? 0;
  const priorTotal = progressData?.prior?.total   ?? 0;
  const delta      = curTotal - priorTotal;
  const deltaPct   = priorTotal > 0 ? Math.round((delta / priorTotal) * 100) : null;

  // Build chart data (same as ProgressTab)
  const fullPts  = progressData?.fullPeriod?.points ?? [];
  const curPts   = progressData?.current?.points ?? [];
  const priorFullPts = progressData?.priorFull?.points ?? [];
  const curByDate   = new Map(curPts.map(p => [p.date, p.cum]));
  const chartData = fullPts.map((p, i) => ({
    label:   p.date.slice(5),
    current: curByDate.has(p.date)   ? Math.round(curByDate.get(p.date)! * 100) / 100 : null,
    prior:   priorFullPts[i] != null ? Math.round(priorFullPts[i].cum * 100) / 100 : null,
  }));

  // X-axis tick formatter (same as ProgressTab)
  const DAY_NAMES = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  // Compute 3 evenly-spaced tick positions for MTD based on total days in month
  const mtdTickPositions = (() => {
    const progPeriod = toProgressPeriod(period);
    if (progPeriod !== 'mtd' || fullPts.length === 0) return [];
    const totalDays = fullPts.length;
    const step = Math.max(1, Math.floor(totalDays / 3));
    return [0, step, step * 2].filter(i => i < totalDays);
  })();
  function formatXLabel(label: string, index: number): string {
    const progPeriod = toProgressPeriod(period);
    if (progPeriod === 'wtd') return DAY_NAMES[index % 7];
    if (progPeriod === 'mtd') {
      if (mtdTickPositions.includes(index)) {
        const day = parseInt(label.slice(3), 10);
        return `${MONTHS[parseInt(label.slice(0,2), 10) - 1]} ${day}`;
      }
      return '';
    }
    const month = parseInt(label.slice(0, 2), 10);
    if (month === 1 || month % 2 === 0) return MONTHS[month - 1];
    return '';
  }

  function fmtProgress(v: number): string {
    if (metric === 'km')    return v >= 100 ? Math.round(v).toString() : v.toFixed(1);
    if (metric === 'hours') return v >= 10  ? Math.round(v).toString() : v.toFixed(1);
    return Math.round(v).toString();
  }

  return (
    <div className="space-y-4">
      {/* Summary cards — swipeable left/right to change period (Week→Month→Year) */}
      <div
        className="select-none touch-pan-y"
        onTouchStart={e => { swipeStartX.current = e.touches[0].clientX; }}
        onTouchEnd={e => {
          if (swipeStartX.current === null) return;
          const dx = e.changedTouches[0].clientX - swipeStartX.current;
          swipeStartX.current = null;
          if (Math.abs(dx) > 40) handleStatSwipe(dx < 0 ? 'left' : 'right');
        }}
      >
        {/* Period indicator dots */}
        <div className="flex items-center justify-center gap-1.5 mb-2">
          {(['week', 'month', 'year'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => changePeriod(p)}
              className={`transition-all rounded-full ${
                period === p ? 'w-4 h-1.5 bg-orange-500' : 'w-1.5 h-1.5 bg-gray-700 hover:bg-gray-500'
              }`}
              aria-label={p}
            />
          ))}
        </div>

        {/* Period label — tapping navigates to the Progress screen */}
        <div className="text-center mb-2">
          <Link
            href="/training"
            className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-orange-400 transition-colors group"
          >
            {period === 'week' ? 'Week to date' : period === 'month' ? 'Month to date' : 'Year to date'}
            <svg className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        {progressLoading && !progressData ? (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="bg-gray-800 rounded-xl p-3 h-16 animate-pulse" />)}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 2 }).map((_, i) => <div key={i} className="bg-gray-800 rounded-xl p-3 h-16 animate-pulse" />)}
            </div>
          </div>
        ) : progressData ? (() => {
          const from = periodStart(period, offset);
          const filtersQ = selected.length > 0 ? selected.join(',') : 'All';
          const href = `/dashboard?tab=activities&filters=${encodeURIComponent(filtersQ)}&from=${from}`;
          return (
            <div className="space-y-2 md:space-y-0">
              {/* Mobile: 3+2 layout. Desktop: single 5-column row. */}
              <div className="grid grid-cols-3 md:grid-cols-5 gap-2 md:gap-3">
                <StatCard label="Rides" value={String(progressData.current?.points.length ?? 0)} href={href} />
                <StatCard label="km"    value={fmtProgress(curTotal)}         href={href} />
                <StatCard label="Hours" value={fmtProgress(curTotal)}      href={href} />
                <div className="hidden md:contents">
                  <StatCard label="TSS"    value={fmtProgress(curTotal)}       href={href} />
                  <StatCard label="Elev m" value={fmtProgress(curTotal)} href={href} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 md:hidden">
                <StatCard label="TSS"    value={fmtProgress(curTotal)}       href={href} />
                <StatCard label="Elev m" value={fmtProgress(curTotal)} href={href} />
              </div>
            </div>
          );
        })() : null}
      </div>

      {/* Sport filters — single scrollable row */}
      <div className="overflow-x-auto scrollbar-thin -mx-4 px-4">
        <div className="flex gap-2 min-w-max">
          {TYPE_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => toggleFilter(f)}
              className={`flex-shrink-0 py-1.5 px-3 rounded-lg text-xs font-medium transition-colors ${
                selected.includes(f)
                  ? 'bg-orange-500 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Metric toggle — evenly spread above chart */}
      <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
        {METRIC_OPTS.map(m => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={`py-1.5 rounded-lg text-xs font-medium transition-colors text-center ${
              metric === m.key
                ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                : 'bg-gray-800 text-gray-500 hover:text-gray-300'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Period selector — Week / Month / Year */}
      <div className="flex bg-gray-800 rounded-xl p-1 gap-1">
        {(['week', 'month', 'year'] as Period[]).map(p => (
          <button
            key={p}
            onClick={() => changePeriod(p)}
            className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${
              period === p ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            {p === 'week' ? 'Week' : p === 'month' ? 'Month' : 'Year'}
          </button>
        ))}
      </div>

      {/* Period navigation — above chart */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setOffset(o => o - 1)}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-medium text-white">
          {progressLoading && !progressData ? '…' : progressData?.current?.start ?? ''}
        </span>
        <button
          onClick={() => setOffset(o => Math.min(0, o + 1))}
          disabled={offset >= 0}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Cumulative area chart (same as ProgressTab) */}
      <div className="bg-gray-800/60 rounded-xl p-3 md:p-5">
        {progressLoading && !progressData ? (
          <div className="h-48 animate-pulse bg-gray-700/40 rounded-lg" />
        ) : chartData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-gray-600 text-sm">No data for this period</div>
        ) : (
          <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="dashProgressGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#f97316" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: '#6b7280', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                tickFormatter={formatXLabel}
              />
              <YAxis
                tick={{ fill: '#6b7280', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={36}
                tickFormatter={v => fmtProgress(Number(v))}
              />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#9ca3af' }}
                formatter={(v, name) => [
                  `${fmtProgress(Number(v))}${m.unit ? ' ' + m.unit : ''}`,
                  name === 'current' ? 'This period' : 'Prior period',
                ]}
              />
              <Line
                type="monotone"
                dataKey="prior"
                stroke="#6b7280"
                strokeWidth={1.5}
                strokeDasharray="5 3"
                dot={false}
                connectNulls
              />
              <Area
                type="monotone"
                dataKey="current"
                stroke="#f97316"
                strokeWidth={2.5}
                fill="url(#dashProgressGrad)"
                dot={false}
                activeDot={{ r: 5, fill: '#f97316' }}
                connectNulls
              />
            </AreaChart>
          </ResponsiveContainer>
          </div>
        )}
      </div>

    </div>
  );
}

export default function DashboardHome() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as Tab | null) ?? 'feed';
  const settingsTab = (searchParams.get('settingsTab') as 'profile' | 'plans' | 'events' | null) ?? 'profile';
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div className="h-full flex flex-col md:flex-row">

      {/* Mobile: horizontal tab bar with overflow */}
      <MobileTabBar tabs={NAV} active={tab} onSelect={setTab} />

      {/* Desktop: vertical sub-tab sidebar */}
      <aside className="hidden md:flex flex-col flex-shrink-0 w-56 border-r border-gray-800 bg-gray-950/50 py-6 px-3 gap-1">
        <div className="px-3 pb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          Dashboard
        </div>
        {NAV.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2.5 text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === key
                ? 'bg-orange-500/15 text-orange-400 border-l-2 border-orange-500 pl-[10px]'
                : 'text-gray-400 hover:text-white hover:bg-gray-800/60'
            }`}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </aside>

      {/* Content */}
      <div className="flex-1 overflow-hidden min-w-0">
        {tab === 'feed'       && <FeedPage />}
        {tab === 'activities' && <ActivitiesList />}
        {tab === 'settings'   && <ProfileEditor initialTab={settingsTab} />}
        {tab === 'progress'   && (
          <div className="h-full overflow-y-auto scroll-touch px-4 py-4 md:px-8 md:py-8">
            <div className="md:max-w-6xl md:mx-auto">
              <TrainingTab />
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
