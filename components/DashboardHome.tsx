'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { SPORT_FILTER_LABELS, CYCLING_TYPES, SportFilter, sportColor, sportLabel } from '@/lib/sport-types';
import ActivitiesList from './ActivitiesList';
import FeedPage from './FeedPage';
import ProfileEditor from './ProfileEditor';

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

const TYPE_FILTERS = SPORT_FILTER_LABELS.filter(f => f !== 'All') as SportFilter[];

const METRIC_OPTS: { key: Metric; label: string; unit: string }[] = [
  { key: 'km',         label: 'Distance',  unit: 'km' },
  { key: 'hours',      label: 'Time',      unit: 'h'  },
  { key: 'activities', label: 'Rides',     unit: ''   },
  { key: 'tss',        label: 'TSS',       unit: ''   },
];

const NAV: { key: Tab; label: string }[] = [
  { key: 'feed',       label: 'Feed'        },
  { key: 'activities', label: 'Activities'  },
  { key: 'progress',   label: 'Progress'    },
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
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-gray-400 mb-1">{label}</p>
      {nonZero.map(p => {
        const type = p.dataKey.slice(metric.length + 1);
        return (
          <p key={p.dataKey} style={{ color: p.fill }} className="font-medium">
            {sportLabel(type)}: {fmt(Number(p.value))}{unit ? ` ${unit}` : ''}
          </p>
        );
      })}
      {nonZero.length > 1 && (
        <p className="text-white font-semibold border-t border-gray-700 mt-1 pt-1">
          Total: {fmt(total)}{unit ? ` ${unit}` : ''}
        </p>
      )}
    </div>
  );
}

const CHART_CACHE_KEY = (period: Period, offset: number, filters: string) =>
  `cache-chart-${period}-${offset}-${filters}`;
const INITIAL_CHART_KEY = CHART_CACHE_KEY('week', 0, 'All');

function TrainingTab() {
  const [period, setPeriod]   = useState<Period>('week');
  const [offset, setOffset]   = useState(0);
  const [metric, setMetric]   = useState<Metric>('km');
  const [selected, setSelected] = useState<SportFilter[]>([]);
  const [data, setData] = useState<ChartResponse | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const s = localStorage.getItem(INITIAL_CHART_KEY);
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  });
  const [loading, setLoading] = useState(() => {
    if (typeof window === 'undefined') return true;
    try { return !localStorage.getItem(INITIAL_CHART_KEY); }
    catch { return true; }
  });
  const [error, setError] = useState<string | null>(null);

  function changePeriod(p: Period) { setPeriod(p); setOffset(0); }

  function toggleFilter(f: SportFilter) {
    setSelected(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);
  }

  const filtersParam = selected.length > 0 ? selected.join(',') : 'All';

  const load = useCallback(() => {
    const cacheKey = CHART_CACHE_KEY(period, offset, filtersParam);
    let cachedData: ChartResponse | null = null;
    try {
      const s = localStorage.getItem(cacheKey);
      if (s) cachedData = JSON.parse(s);
    } catch {}
    if (cachedData) { setData(cachedData); setLoading(false); }
    else setLoading(true);
    setError(null);

    fetch(`/api/dashboard/chart?period=${period}&offset=${offset}&filters=${encodeURIComponent(filtersParam)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setData(null); }
        else {
          setData(d);
          try { localStorage.setItem(cacheKey, JSON.stringify(d)); } catch {}
        }
        setLoading(false);
      })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [period, offset, filtersParam]);

  useEffect(() => { load(); }, [load]);

  const metricCfg = METRIC_OPTS.find(m => m.key === metric)!;

  const flatBars: FlatBar[] = (data?.bars ?? []).map(b => {
    const flat: FlatBar = { ...b };
    for (const type of CYCLING_TYPES) {
      flat[`${metric}_${type}`] = b.byType?.[type]?.[metric] ?? 0;
    }
    return flat;
  });

  function barLabel(value: number) {
    if (!value) return '';
    if (metric === 'km')    return value >= 100 ? Math.round(value).toString() : value.toFixed(1);
    if (metric === 'hours') return value >= 10  ? Math.round(value).toString() : value.toFixed(1);
    return Math.round(value).toString();
  }

  return (
    <div className="space-y-4">
      {/* Summary cards — 3 top, 2 bottom */}
      {loading && !data ? (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="bg-gray-800 rounded-xl p-3 h-16 animate-pulse" />)}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 2 }).map((_, i) => <div key={i} className="bg-gray-800 rounded-xl p-3 h-16 animate-pulse" />)}
          </div>
        </div>
      ) : data ? (() => {
        const from = periodStart(period, offset);
        const filtersQ = selected.length > 0 ? selected.join(',') : 'All';
        const href = `/dashboard?tab=activities&filters=${encodeURIComponent(filtersQ)}&from=${from}`;
        return (
          <div className="space-y-2 md:space-y-0">
            {/* Mobile: 3+2 layout. Desktop: single 5-column row. */}
            <div className="grid grid-cols-3 md:grid-cols-5 gap-2 md:gap-3">
              <StatCard label="Rides" value={String(data.summary.activities ?? 0)} href={href} />
              <StatCard label="km"    value={String(data.summary.km ?? 0)}         href={href} />
              <StatCard label="Hours" value={String(data.summary.hours ?? 0)}      href={href} />
              <div className="hidden md:contents">
                <StatCard label="TSS"    value={String(data.summary.tss ?? 0)}       href={href} />
                <StatCard label="Elev m" value={String(data.summary.elevation ?? 0)} href={href} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 md:hidden">
              <StatCard label="TSS"    value={String(data.summary.tss ?? 0)}       href={href} />
              <StatCard label="Elev m" value={String(data.summary.elevation ?? 0)} href={href} />
            </div>
          </div>
        );
      })() : null}

      {/* Sport filters — evenly spread above chart */}
      <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
        {TYPE_FILTERS.map(f => (
          <button
            key={f}
            onClick={() => toggleFilter(f)}
            className={`py-1.5 rounded-lg text-xs font-medium transition-colors text-center ${
              selected.includes(f)
                ? 'bg-orange-500 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}
          >
            {f}
          </button>
        ))}
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
          {loading && !data ? '…' : data?.label ?? ''}
        </span>
        <button
          onClick={() => setOffset(o => o + 1)}
          disabled={!data?.canGoForward}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Bar chart */}
      <div className="bg-gray-800/60 rounded-xl p-3 md:p-5">
        {error ? (
          <div className="h-48 md:h-80 flex items-center justify-center">
            <p className="text-red-400 text-xs text-center px-4">{error}</p>
          </div>
        ) : loading && !data ? (
          <div className="h-48 md:h-80 animate-pulse bg-gray-800 rounded-lg" />
        ) : (
          <div className="h-[220px] md:h-[340px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={flatBars} margin={{ top: 20, right: 4, left: 4, bottom: 0 }} barCategoryGap="25%">
              <XAxis
                dataKey="label"
                tick={{ fill: '#9ca3af', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis hide />
              <Tooltip
                content={<CustomTooltip metric={metric} unit={metricCfg.unit} />}
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              />
              {CYCLING_TYPES.map((type, i) => (
                <Bar
                  key={type}
                  dataKey={`${metric}_${type}`}
                  stackId="a"
                  fill={sportColor(type)}
                  radius={i === CYCLING_TYPES.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                />
              ))}
              <Bar
                dataKey={() => 0}
                stackId="a"
                fill="transparent"
                stroke="none"
                isAnimationActive={false}
                legendType="none"
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                shape={(props: any) => {
                  const { x, y, width } = props;
                  const total = Number(props[metric]) || 0;
                  if (!total) return <g />;
                  return (
                    <text
                      x={x + width / 2}
                      y={y - 5}
                      textAnchor="middle"
                      fill="#d1d5db"
                      fontSize={10}
                      fontWeight={500}
                    >
                      {barLabel(total)}
                    </text>
                  );
                }}
              />
            </BarChart>
          </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex gap-3 flex-wrap">
        {CYCLING_TYPES.map(type => (
          <div key={type} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: sportColor(type) }} />
            <span className="text-xs text-gray-400">{sportLabel(type)}</span>
          </div>
        ))}
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
    <div className="h-full flex flex-col">

      {/* Horizontal tab bar */}
      <div className="flex-shrink-0 flex border-b border-gray-800 overflow-x-auto md:px-8 md:gap-2 md:max-w-7xl md:mx-auto md:w-full">
        {NAV.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-5 md:px-6 py-3 md:py-4 text-sm md:text-base font-medium whitespace-nowrap border-b-2 transition-colors -mb-px ${
              tab === key
                ? 'border-orange-500 text-white'
                : 'border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

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
