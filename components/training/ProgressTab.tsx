'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart, Area, Line,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { SPORT_FILTER_LABELS, SportFilter } from '@/lib/sport-types';
import { useCachedFetch } from '@/lib/use-cached-fetch';
import EnlargeableChart from '@/components/EnlargeableChart';
import TrainingCalendar from './TrainingCalendar';
import TssRollingChart from './TssRollingChart';

type Period = 'wtd' | 'mtd' | 'ytd';
type Metric = 'km' | 'time' | 'elevation' | 'tss' | 'activities';

interface DayPoint { date: string; value: number; cum: number }
interface ProgressResponse {
  current: { start: string; end: string; total: number; points: DayPoint[] };
  prior:   { start: string; end: string; total: number; points: DayPoint[] };
  fullPeriod: { start: string; end: string; points: DayPoint[] };
  priorFull: { start: string; end: string; points: DayPoint[] };
}

const METRICS: { key: Metric; label: string; unit: string; fmt: (v: number) => string }[] = [
  { key: 'km',         label: 'Distance',   unit: 'km', fmt: v => v >= 100 ? Math.round(v).toString() : v.toFixed(1) },
  { key: 'time',       label: 'Time',       unit: 'h',  fmt: v => v >= 10 ? Math.round(v).toString() : v.toFixed(1) },
  { key: 'tss',        label: 'TSS',        unit: '',   fmt: v => Math.round(v).toString() },
  { key: 'activities', label: 'Activities', unit: '',   fmt: v => Math.round(v).toString() },
  { key: 'elevation',  label: 'Elevation',  unit: 'm',  fmt: v => Math.round(v).toLocaleString() },
];

const PERIODS: { key: Period; label: string }[] = [
  { key: 'wtd', label: 'WTD' },
  { key: 'mtd', label: 'MTD' },
  { key: 'ytd', label: 'YTD' },
];

const TYPE_OPTIONS = SPORT_FILTER_LABELS.filter(f => f !== 'All') as SportFilter[];

function fmtRange(start: string, end: string, period: Period): string {
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  if (period === 'ytd') {
    if (sy === ey) return `Jan 1 – ${M[em-1]} ${ed}, ${sy}`;
    return `${M[sm-1]} ${sd}, ${sy} – ${M[em-1]} ${ed}, ${ey}`;
  }
  if (sm === em && sy === ey) return `${M[sm-1]} ${sd} – ${ed}, ${sy}`;
  return `${M[sm-1]} ${sd} – ${M[em-1]} ${ed}`;
}

// ── Sport Dropdown ────────────────────────────────────────────────────────────
function SportDropdown({ selected, onChange }: {
  selected: SportFilter[];
  onChange: (v: SportFilter[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  function toggle(f: SportFilter) {
    onChange(selected.includes(f) ? selected.filter(x => x !== f) : [...selected, f]);
  }

  const label = selected.length === 0 ? 'All' : selected.length === 1 ? selected[0] : `${selected.length} types`;

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-700 bg-gray-800 text-xs font-medium text-white hover:border-gray-600 transition-colors"
      >
        {label}
        <svg className={`w-3 h-3 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-20 top-full left-0 mt-1.5 bg-gray-800 border border-gray-700 rounded-xl p-1.5 shadow-xl min-w-[110px]">
          {TYPE_OPTIONS.map(f => (
            <label
              key={f}
              className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-gray-700/60 cursor-pointer transition-colors"
            >
              <input
                type="checkbox"
                className="w-3.5 h-3.5 accent-orange-500 cursor-pointer"
                checked={selected.includes(f)}
                onChange={() => toggle(f)}
              />
              <span className="text-xs text-gray-200">{f}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ProgressTab() {
  const [period,   setPeriod]   = useState<Period>('wtd');
  const [metric,   setMetric]   = useState<Metric>('km');
  const [selected, setSelected] = useState<SportFilter[]>([]);
  const [offset,   setOffset]   = useState(0);

  const filtersParam = selected.length > 0 ? selected.join(',') : 'All';
  const qs = `period=${period}&metric=${metric}&filters=${encodeURIComponent(filtersParam)}&offset=${offset}`;
  const { data, loading } = useCachedFetch<ProgressResponse>(
    `/api/training/progress?${qs}`,
    `cache-training-progress-${qs}`,
  );

  const m           = METRICS.find(x => x.key === metric)!;
  const curTotal    = data?.current?.total ?? 0;
  const priorTotal  = data?.prior?.total   ?? 0;
  const delta       = curTotal - priorTotal;
  const deltaPct    = priorTotal > 0 ? Math.round((delta / priorTotal) * 100) : null;
  const dateRange   = data?.current ? fmtRange(data.current.start, data.current.end, period) : '—';

  // Build chart data from fullPeriod for the x-axis (shows entire period range)
  // Use priorFull for the prior line so it extends to the end of the graph.
  // Since priorFull dates are from a different period (e.g. last week), we align
  // them by index (same relative position in the period) rather than by date.
  const fullPts  = data?.fullPeriod?.points ?? [];
  const curPts   = data?.current?.points ?? [];
  const priorFullPts = data?.priorFull?.points ?? [];
  // Build a lookup of cum values keyed by date
  const curByDate   = new Map(curPts.map(p => [p.date, p.cum]));
  const chartData = fullPts.map((p, i) => ({
    label:   p.date.slice(5),
    current: curByDate.has(p.date)   ? Math.round(curByDate.get(p.date)! * 100) / 100 : null,
    prior:   priorFullPts[i] != null ? Math.round(priorFullPts[i].cum * 100) / 100 : null,
  }));

  // ── X-axis tick formatter ───────────────────────────────────────────
  const DAY_NAMES = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  // Compute 3 evenly-spaced tick positions for MTD based on total days in month
  const mtdTickPositions = (() => {
    if (period !== 'mtd' || fullPts.length === 0) return [];
    const totalDays = fullPts.length;
    const step = Math.max(1, Math.floor(totalDays / 3));
    return [0, step, step * 2].filter(i => i < totalDays);
  })();
  // Track last month shown on YTD x-axis to avoid duplicates
  let lastYtdMonth = -1;
  function formatXLabel(label: string, index: number): string {
    if (period === 'wtd') {
      // label is "MM-DD" — derive day-of-week from index
      return DAY_NAMES[index % 7];
    }
    if (period === 'mtd') {
      // Show 3 evenly spaced markers based on total days in month
      if (mtdTickPositions.includes(index)) {
        const day = parseInt(label.slice(3), 10);
        return `${MONTHS[parseInt(label.slice(0,2), 10) - 1]} ${day}`;
      }
      return '';
    }
    // ytd — label is "MM-DD", show every second month starting from Feb
    // Show label only on the first occurrence of each even month
    const month = parseInt(label.slice(0, 2), 10);
    if (month % 2 === 0 && month !== lastYtdMonth) {
      lastYtdMonth = month;
      return MONTHS[month - 1];
    }
    return '';
  }

  return (
    <div className="space-y-4">

      {/* Heading */}
      <h2 className="text-sm font-semibold text-white">Progress</h2>

      {/* Controls: sport dropdown + metric pills (scrollable row) */}
      <div className="flex items-center gap-2">
        <SportDropdown
          selected={selected}
          onChange={v => { setSelected(v); setOffset(0); }}
        />
        <div className="overflow-x-auto scrollbar-thin -mr-4 pr-4">
          <div className="flex items-center gap-2 min-w-max">
            {METRICS.map(mx => (
              <button
                key={mx.key}
                onClick={() => { setMetric(mx.key); setOffset(0); }}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                  metric === mx.key
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'bg-transparent text-gray-400 border-gray-700 hover:text-white hover:border-gray-500'
                }`}
              >
                {mx.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart panel */}
      <div className="bg-gray-800/60 rounded-xl p-4 space-y-3">

        {/* Total header */}
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider">Total {m.label}</p>
          {loading ? (
            <div className="h-9 w-36 bg-gray-700/50 rounded animate-pulse mt-1" />
          ) : (
            <div className="flex items-end gap-2.5 mt-0.5">
              <p className="text-3xl font-bold text-white leading-tight">
                {m.fmt(curTotal)}
                {m.unit && <span className="text-lg font-semibold text-gray-400 ml-1">{m.unit}</span>}
              </p>
              {deltaPct !== null && (
                <p className={`text-sm font-semibold mb-0.5 ${deltaPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {deltaPct >= 0 ? '▲' : '▼'} {delta >= 0 ? '+' : ''}{m.fmt(Math.abs(delta))}{m.unit ? ` ${m.unit}` : ''} ({Math.abs(deltaPct)}%)
                </p>
              )}
            </div>
          )}
          <p className="text-xs text-gray-500 mt-0.5">{dateRange}</p>
          {deltaPct !== null && priorTotal > 0 && (
            <p className="text-[10px] text-gray-600 mt-0.5">
              vs. prior period ({m.fmt(priorTotal)}{m.unit ? ` ${m.unit}` : ''})
            </p>
          )}
        </div>

        {/* Area chart */}
        {loading ? (
          <div className="h-48 animate-pulse bg-gray-700/40 rounded-lg" />
        ) : chartData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-gray-600 text-sm">No data for this period</div>
        ) : (
          <EnlargeableChart title={`Total ${m.label}`} subtitle={dateRange} controls={
            <div className="flex items-center gap-2">
              <div className="flex bg-gray-800 rounded-lg p-0.5 gap-0.5">
                {PERIODS.map(p => (
                  <button
                    key={p.key}
                    onClick={() => { setPeriod(p.key); setOffset(0); }}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      period === p.key ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setOffset(o => o - 1)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                  aria-label="Previous period"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  onClick={() => setOffset(o => Math.min(0, o + 1))}
                  disabled={offset >= 0}
                  className={`p-1.5 rounded-lg transition-colors ${
                    offset >= 0 ? 'text-gray-700 cursor-not-allowed' : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`}
                  aria-label="Next period"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          }>{(fs) => (
          <ResponsiveContainer width="100%" height={fs ? '100%' : 200}>
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="progressGrad" x1="0" y1="0" x2="0" y2="1">
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
                tickFormatter={v => m.fmt(Number(v))}
              />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#9ca3af' }}
                formatter={(v, name) => [
                  `${m.fmt(Number(v))}${m.unit ? ' ' + m.unit : ''}`,
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
                fill="url(#progressGrad)"
                dot={false}
                activeDot={{ r: 5, fill: '#f97316' }}
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
          )}</EnlargeableChart>
        )}
      </div>

      {/* Period selector */}
      <div className="flex bg-gray-800 rounded-xl p-1 gap-1">
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

      {/* Navigation arrows */}
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
        <span className="text-sm text-gray-200 font-medium tabular-nums">{dateRange}</span>
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

      {/* Weekly TSS — above calendar */}
      <div id="weekly-tss" className="border-t border-gray-800/60 pt-4">
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3">Weekly TSS</p>
        <TssRollingChart />
      </div>

      {/* Training calendar */}
      <div className="border-t border-gray-800/60 pt-4">
        <TrainingCalendar numWeeks={8} />
      </div>

    </div>
  );
}
