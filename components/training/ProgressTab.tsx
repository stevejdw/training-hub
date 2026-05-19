'use client';

import { useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart, Line,
  BarChart,  Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { SPORT_FILTER_LABELS, SportFilter } from '@/lib/sport-types';
import { useCachedFetch } from '@/lib/use-cached-fetch';
import TrainingCalendar from './TrainingCalendar';
import TssRollingChart from './TssRollingChart';

type Period    = 'wtd' | 'mtd' | 'ytd';
type Metric    = 'time' | 'km';
type ChartType = 'line' | 'bar';

interface DayPoint { date: string; value: number; cum: number }
interface ProgressResponse {
  current: { start: string; end: string; total: number; points: DayPoint[] };
  prior:   { start: string; end: string; total: number; points: DayPoint[] };
}

const TYPE_FILTERS = SPORT_FILTER_LABELS.filter(f => f !== 'All') as SportFilter[];
const PERIODS: { key: Period; label: string }[] = [
  { key: 'wtd', label: 'WTD' },
  { key: 'mtd', label: 'MTD' },
  { key: 'ytd', label: 'YTD' },
];
const METRICS: { key: Metric; label: string; unit: string }[] = [
  { key: 'time', label: 'Time', unit: 'h'  },
  { key: 'km',   label: 'KM',   unit: 'km' },
];

function fmt(v: number, metric: Metric): string {
  if (metric === 'time') return v >= 10 ? Math.round(v).toString() : v.toFixed(1);
  return v >= 100 ? Math.round(v).toString() : v.toFixed(1);
}

function fmtRange(start: string, end: string, period: Period): string {
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  if (period === 'ytd') {
    if (sy === ey && sm === 1 && sd === 1 && em === 12 && ed === 31) return String(sy);
    if (sy === ey) return `${M[sm-1]} ${sd} – ${M[em-1]} ${ed}, ${sy}`;
    return `${M[sm-1]} ${sd}, ${sy} – ${M[em-1]} ${ed}, ${ey}`;
  }
  if (period === 'mtd') {
    const lastDay = new Date(Date.UTC(ey, em, 0)).getUTCDate();
    if (sm === em && sy === ey && sd === 1 && ed === lastDay) return `${M[sm-1]} ${sy}`;
    if (sm === em && sy === ey) return `${M[sm-1]} ${sd} – ${ed}, ${sy}`;
    return `${M[sm-1]} ${sd} – ${M[em-1]} ${ed}`;
  }
  if (sm === em && sy === ey) return `${M[sm-1]} ${sd} – ${ed}`;
  return `${M[sm-1]} ${sd} – ${M[em-1]} ${ed}`;
}

const PERIOD_ORDER: Period[] = ['wtd', 'mtd', 'ytd'];

export default function ProgressTab() {
  const [period,    setPeriod]    = useState<Period>('wtd');
  const [metric,    setMetric]    = useState<Metric>('time');
  const [selected,  setSelected]  = useState<SportFilter[]>([]);
  const [offset,    setOffset]    = useState(0);
  const [chartType, setChartType] = useState<ChartType>('line');

  const swipeStartX = useRef<number | null>(null);

  function handlePeriodSwipe(dir: 'left' | 'right') {
    const idx  = PERIOD_ORDER.indexOf(period);
    const next = dir === 'left'
      ? PERIOD_ORDER[Math.min(PERIOD_ORDER.length - 1, idx + 1)]
      : PERIOD_ORDER[Math.max(0, idx - 1)];
    if (next !== period) { setPeriod(next); setOffset(0); }
  }

  const filtersParam = selected.length > 0 ? selected.join(',') : 'All';
  const qs = `period=${period}&metric=${metric}&filters=${encodeURIComponent(filtersParam)}&offset=${offset}`;
  const { data, loading } = useCachedFetch<ProgressResponse>(
    `/api/training/progress?${qs}`,
    `cache-training-progress-${qs}`,
  );

  function toggleFilter(f: SportFilter) {
    setSelected(p => p.includes(f) ? p.filter(x => x !== f) : [...p, f]);
  }

  // Line chart: cumulative day-by-day (fine for all periods — line smooths density)
  const chartData = useMemo(() => {
    if (!data?.current?.points || !data?.prior?.points) return [];
    const len = Math.max(data.current.points.length, data.prior.points.length);
    const rows: {
      idx: number; label: string;
      current: number | null; prior: number | null;
    }[] = [];
    for (let i = 0; i < len; i++) {
      const c = data.current.points[i];
      const p = data.prior.points[i];
      const label = c?.date ? c.date.slice(5) : (p?.date ?? `day ${i + 1}`);
      rows.push({ idx: i + 1, label, current: c?.cum ?? null, prior: p?.cum ?? null });
    }
    return rows;
  }, [data]);

  // Bar chart: aggregated per period for readability
  //   WTD → 7 daily bars  (Mon … Sun)
  //   MTD → 4–5 weekly bars (W1 … W4/W5)
  //   YTD → 12 monthly bars (Jan … Dec)
  const barData = useMemo(() => {
    if (!data?.current?.points) return [];
    const DAYS   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    if (period === 'wtd') {
      return data.current.points.map((p, i) => ({
        label:   DAYS[i] ?? p.date.slice(5),
        current: Math.round(p.value * 10) / 10,
        prior:   Math.round((data.prior?.points[i]?.value ?? 0) * 10) / 10,
      }));
    }

    if (period === 'mtd') {
      const weeks: { label: string; current: number; prior: number }[] = [];
      for (const p of data.current.points) {
        const wk = Math.ceil(parseInt(p.date.slice(8), 10) / 7);
        const idx = wk - 1;
        if (!weeks[idx]) weeks[idx] = { label: `W${wk}`, current: 0, prior: 0 };
        weeks[idx].current = Math.round((weeks[idx].current + p.value) * 10) / 10;
      }
      for (const p of (data.prior?.points ?? [])) {
        const wk = Math.ceil(parseInt(p.date.slice(8), 10) / 7);
        const idx = wk - 1;
        if (!weeks[idx]) weeks[idx] = { label: `W${wk}`, current: 0, prior: 0 };
        weeks[idx].prior = Math.round((weeks[idx].prior + p.value) * 10) / 10;
      }
      return weeks.filter(Boolean);
    }

    // ytd
    const months: { label: string; current: number; prior: number }[] =
      MONTHS.map(l => ({ label: l, current: 0, prior: 0 }));
    for (const p of data.current.points) {
      const mo = parseInt(p.date.slice(5, 7), 10) - 1;
      months[mo].current = Math.round((months[mo].current + p.value) * 10) / 10;
    }
    for (const p of (data.prior?.points ?? [])) {
      const mo = parseInt(p.date.slice(5, 7), 10) - 1;
      months[mo].prior = Math.round((months[mo].prior + p.value) * 10) / 10;
    }
    return months;
  }, [data, period]);

  const unit       = METRICS.find(m => m.key === metric)!.unit;
  const curTotal   = data?.current?.total ?? 0;
  const priorTotal = data?.prior?.total   ?? 0;
  const delta      = curTotal - priorTotal;
  const deltaPct   = priorTotal > 0 ? ((delta / priorTotal) * 100) : null;
  const deltaColor = delta > 0 ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-gray-400';

  const tooltipStyle = {
    contentStyle: { background: '#0f172a', border: '1px solid #374151', borderRadius: 8, fontSize: 12 },
    labelStyle:   { color: '#9ca3af' },
  };

  return (
    <div className="space-y-4">

      {/* Period type: WTD / MTD / YTD — swipeable */}
      <div
        className="flex bg-gray-800 rounded-xl p-1 gap-1 select-none touch-pan-y"
        onTouchStart={e => { swipeStartX.current = e.touches[0].clientX; }}
        onTouchEnd={e => {
          if (swipeStartX.current === null) return;
          const dx = e.changedTouches[0].clientX - swipeStartX.current;
          swipeStartX.current = null;
          if (Math.abs(dx) > 40) handlePeriodSwipe(dx < 0 ? 'left' : 'right');
        }}
      >
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => { setPeriod(p.key); setOffset(0); }}
            className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              period === p.key ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Metric toggle */}
      <div className="grid grid-cols-2 gap-2">
        {METRICS.map(m => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
              metric === m.key
                ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                : 'bg-gray-800 text-gray-500 hover:text-gray-300'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Sport filters */}
      <div className="grid grid-cols-4 gap-2">
        {TYPE_FILTERS.map(f => (
          <button
            key={f}
            onClick={() => toggleFilter(f)}
            className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
              selected.includes(f)
                ? 'bg-orange-500 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Totals + delta vs prior period */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gray-800 rounded-xl p-3">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">{period.toUpperCase()}</div>
          <div className="text-xl font-bold text-white">{fmt(curTotal, metric)}<span className="text-xs text-gray-400 ml-1">{unit}</span></div>
        </div>
        <div className="bg-gray-800 rounded-xl p-3">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">Prior</div>
          <div className="text-xl font-bold text-gray-400">{fmt(priorTotal, metric)}<span className="text-xs text-gray-500 ml-1">{unit}</span></div>
        </div>
        <div className="bg-gray-800 rounded-xl p-3">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">Δ vs Prior</div>
          <div className={`text-xl font-bold ${deltaColor}`}>
            {delta >= 0 ? '+' : ''}{fmt(Math.abs(delta), metric)}
            <span className="text-xs ml-1">{unit}</span>
          </div>
          {deltaPct !== null && (
            <div className={`text-[10px] mt-0.5 ${deltaColor}`}>{deltaPct >= 0 ? '+' : ''}{deltaPct.toFixed(0)}%</div>
          )}
        </div>
      </div>

      {/* Chart — click to toggle line ↔ bar */}
      <div
        className="bg-gray-800/60 rounded-xl p-3 md:p-5 cursor-pointer select-none"
        onClick={() => setChartType(t => t === 'line' ? 'bar' : 'line')}
        title="Click to switch chart type"
      >
        {/* Toggle hint */}
        <div className="flex items-center justify-end mb-1 gap-1.5">
          <span className="text-[10px] text-gray-600">tap to switch</span>
          <span className={`text-[10px] font-medium ${chartType === 'line' ? 'text-orange-400' : 'text-gray-500'}`}>Line</span>
          <span className="text-[10px] text-gray-700">/</span>
          <span className={`text-[10px] font-medium ${chartType === 'bar' ? 'text-orange-400' : 'text-gray-500'}`}>Bar</span>
        </div>

        {loading ? (
          <div className="h-56 md:h-72 animate-pulse bg-gray-800 rounded-lg" />
        ) : (
          <div className="h-56 md:h-72">
            <ResponsiveContainer width="100%" height="100%">
              {chartType === 'line' ? (
                <LineChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(v) => `${fmt(Number(v) || 0, metric)} ${unit}`}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
                  <Line type="monotone" dataKey="current" stroke="#f97316" strokeWidth={2.5} dot={false} name="Current" />
                  <Line type="monotone" dataKey="prior"   stroke="#6b7280" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="Prior" />
                </LineChart>
              ) : (
                <BarChart
                  data={barData}
                  margin={{ top: 10, right: 12, left: 0, bottom: period === 'ytd' ? 18 : 0 }}
                  barCategoryGap={period === 'ytd' ? '18%' : '25%'}
                >
                  <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#9ca3af', fontSize: period === 'ytd' ? 10 : 11 }}
                    axisLine={false}
                    tickLine={false}
                    angle={period === 'ytd' ? -35 : 0}
                    textAnchor={period === 'ytd' ? 'end' : 'middle'}
                    interval={0}
                  />
                  <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(v) => `${fmt(Number(v) || 0, metric)} ${unit}`}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
                  <Bar dataKey="current" fill="#f97316" name="Current" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="prior"   fill="#4b5563" name="Prior"   radius={[3, 3, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Date-range navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setOffset(o => o - 1)}
          className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          aria-label="Previous period"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm text-gray-200 font-medium tabular-nums">
          {data?.current
            ? fmtRange(data.current.start, data.current.end, period)
            : <span className="text-gray-600">—</span>
          }
        </span>
        <button
          onClick={() => setOffset(o => Math.min(0, o + 1))}
          disabled={offset >= 0}
          className={`p-2 rounded-lg transition-colors ${
            offset >= 0 ? 'text-gray-700 cursor-not-allowed' : 'text-gray-400 hover:text-white hover:bg-gray-800'
          }`}
          aria-label="Next period"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Training calendar */}
      <div className="border-t border-gray-800/60 pt-4">
        <TrainingCalendar numWeeks={8} />
      </div>

      {/* Weekly TSS */}
      <div className="border-t border-gray-800/60 pt-4">
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3">Weekly TSS</p>
        <TssRollingChart />
      </div>

    </div>
  );
}
