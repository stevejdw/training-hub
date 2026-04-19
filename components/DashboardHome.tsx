'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, ReferenceLine, Legend,
} from 'recharts';
import { SPORT_FILTER_LABELS, CYCLING_TYPES, SportFilter, sportColor, sportLabel } from '@/lib/sport-types';
import DashboardBestPower from './DashboardBestPower';
import ActivitiesList from './ActivitiesList';

type Tab    = 'training' | 'power' | 'fitness' | 'activities';
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
  { key: 'training',   label: 'Progress'    },
  { key: 'activities', label: 'Activities'  },
  { key: 'power',      label: 'Best Efforts' },
  { key: 'fitness',    label: 'Fitness'     },
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
    <div className={`bg-gray-800 rounded-xl p-3 flex flex-col gap-0.5 min-w-[80px] transition-colors ${href ? 'group-hover:bg-gray-700 cursor-pointer' : ''}`}>
      <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
      <span className="text-lg font-bold text-white leading-tight">{value}</span>
      {href && <span className="text-[10px] text-orange-400 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">View →</span>}
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

function TrainingTab() {
  const [period, setPeriod]   = useState<Period>('week');
  const [offset, setOffset]   = useState(0);
  const [metric, setMetric]   = useState<Metric>('km');
  const [selected, setSelected] = useState<SportFilter[]>([]);
  const [data, setData]       = useState<ChartResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  function changePeriod(p: Period) { setPeriod(p); setOffset(0); }

  function toggleFilter(f: SportFilter) {
    setSelected(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);
  }

  const filtersParam = selected.length > 0 ? selected.join(',') : 'All';

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/dashboard/chart?period=${period}&offset=${offset}&filters=${encodeURIComponent(filtersParam)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setData(null); }
        else setData(d);
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
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <StatCard label="Rides" value={String(data.summary.activities ?? 0)} href={href} />
              <StatCard label="km"    value={String(data.summary.km ?? 0)}         href={href} />
              <StatCard label="Hours" value={String(data.summary.hours ?? 0)}      href={href} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatCard label="TSS"    value={String(data.summary.tss ?? 0)}       href={href} />
              <StatCard label="Elev m" value={String(data.summary.elevation ?? 0)} href={href} />
            </div>
          </div>
        );
      })() : null}

      {/* Sport filters — evenly spread above chart */}
      <div className="grid grid-cols-4 gap-2">
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
      <div className="grid grid-cols-4 gap-2">
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
      <div className="bg-gray-800/60 rounded-xl p-3">
        {error ? (
          <div className="h-48 flex items-center justify-center">
            <p className="text-red-400 text-xs text-center px-4">{error}</p>
          </div>
        ) : loading && !data ? (
          <div className="h-48 animate-pulse bg-gray-800 rounded-lg" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
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

      {/* Period selector — very bottom */}
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Date</p>
      <div className="flex bg-gray-800 rounded-xl p-1 gap-1 pb-2">
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
    </div>
  );
}

function PowerTab() {
  return (
    <div className="space-y-4">
      <DashboardBestPower />
    </div>
  );
}

interface FitnessPoint { date: string; atl: number; ctl: number; tsb: number }

function FitnessTab() {
  const [data,    setData]    = useState<FitnessPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [days,    setDays]    = useState(90);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/analytics/fitness?days=${days}`)
      .then(r => r.json())
      .then(d => { setData(d.data ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [days]);

  const latest = data[data.length - 1];
  const tsbColor = (v: number) => v >= 5 ? '#34d399' : v <= -20 ? '#f87171' : '#facc15';
  const tsbLabel = (v: number) => v >= 5 ? 'Fresh' : v <= -20 ? 'Fatigued' : 'Neutral';

  // Thin out data for the chart (max 180 points)
  const chartData = data.length > 180
    ? data.filter((_, i) => i % Math.ceil(data.length / 180) === 0).concat(data[data.length - 1])
    : data;

  // Format date for x-axis
  const fmtDate = (s: string) => {
    const d = new Date(s);
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  };

  return (
    <div className="space-y-5">
      {/* Current snapshot */}
      {latest && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gray-800/60 rounded-xl p-3 text-center">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Fitness (CTL)</p>
            <p className="text-2xl font-bold text-blue-400">{latest.ctl}</p>
          </div>
          <div className="bg-gray-800/60 rounded-xl p-3 text-center">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Fatigue (ATL)</p>
            <p className="text-2xl font-bold text-purple-400">{latest.atl}</p>
          </div>
          <div className="bg-gray-800/60 rounded-xl p-3 text-center">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Form (TSB)</p>
            <p className="text-2xl font-bold" style={{ color: tsbColor(latest.tsb) }}>
              {latest.tsb > 0 ? '+' : ''}{latest.tsb}
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: tsbColor(latest.tsb) }}>
              {tsbLabel(latest.tsb)}
            </p>
          </div>
        </div>
      )}

      {/* Range selector */}
      <div className="flex gap-1.5">
        {[30, 90, 180, 365].map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              days === d
                ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                : 'bg-gray-800 text-gray-500 hover:text-gray-300'
            }`}
          >
            {d === 365 ? '1Y' : `${d}D`}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">ATL · CTL · Form (TSB)</p>
        {loading ? (
          <div className="h-64 animate-pulse bg-gray-800 rounded-lg" />
        ) : chartData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-gray-500 text-sm">No TSS data found</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={fmtDate}
                tick={{ fill: '#6b7280', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: '#6b7280', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={32}
              />
              <ReferenceLine y={0} stroke="#374151" strokeDasharray="3 3" />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                labelFormatter={(s: any) => fmtDate(String(s))}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(val: any, name: any) => {
                  const labels: Record<string, string> = { ctl: 'Fitness (CTL)', atl: 'Fatigue (ATL)', tsb: 'Form (TSB)' };
                  const n = Number(val);
                  return [n > 0 ? `+${n}` : n, labels[String(name)] ?? String(name)];
                }}
              />
              <Legend
                formatter={(value) => {
                  const labels: Record<string, string> = { ctl: 'Fitness (CTL)', atl: 'Fatigue (ATL)', tsb: 'Form (TSB)' };
                  return <span style={{ color: '#9ca3af', fontSize: 11 }}>{labels[value] ?? value}</span>;
                }}
              />
              <Line type="monotone" dataKey="ctl" stroke="#60a5fa" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="atl" stroke="#c084fc" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="tsb" stroke="#34d399" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Legend explainer */}
      <div className="grid grid-cols-3 gap-2 text-xs text-gray-500">
        <div><span className="text-blue-400 font-medium">CTL</span> — Chronic Training Load (42d avg). Your fitness base.</div>
        <div><span className="text-purple-400 font-medium">ATL</span> — Acute Training Load (7d avg). Recent fatigue.</div>
        <div><span className="text-green-400 font-medium">TSB</span> — Form = CTL − ATL. Positive = fresh, negative = tired.</div>
      </div>
    </div>
  );
}

export default function DashboardHome() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as Tab | null) ?? 'training';
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div className="h-full flex flex-col">

      {/* Horizontal tab bar */}
      <div className="flex-shrink-0 flex border-b border-gray-800 overflow-x-auto">
        {NAV.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors -mb-px ${
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
        {tab === 'activities' ? (
          <ActivitiesList />
        ) : (
          <div className="h-full overflow-y-auto scroll-touch px-4 py-4">
            {tab === 'training' && <TrainingTab />}
            {tab === 'power'    && <PowerTab />}
            {tab === 'fitness'  && <FitnessTab />}
          </div>
        )}
      </div>

    </div>
  );
}
