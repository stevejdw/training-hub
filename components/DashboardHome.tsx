'use client';

import { useEffect, useState, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import { SPORT_FILTER_LABELS, CYCLING_TYPES, SportFilter, sportColor, sportLabel } from '@/lib/sport-types';

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

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-800 rounded-xl p-3 flex flex-col gap-0.5 min-w-[80px]">
      <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
      <span className="text-lg font-bold text-white leading-tight">{value}</span>
    </div>
  );
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

export default function DashboardHome() {
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

  // Flatten byType into recharts-friendly keys: `${metric}_${sportType}`
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
    <div className="h-full overflow-y-auto scroll-touch">
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">

        {/* Period selector */}
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-800 rounded-xl p-1 gap-1 flex-1">
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

        {/* Period navigation */}
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

        {/* Sport filters */}
        <div className="flex gap-2 flex-wrap">
          {TYPE_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => toggleFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                selected.includes(f)
                  ? 'bg-orange-500 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {f}
            </button>
          ))}
          {selected.length > 0 && (
            <button onClick={() => setSelected([])} className="px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:text-white transition-colors">
              Clear
            </button>
          )}
        </div>

        {/* Summary cards */}
        {loading && !data ? (
          <div className="grid grid-cols-5 gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-gray-800 rounded-xl p-3 h-16 animate-pulse" />
            ))}
          </div>
        ) : data ? (
          <div className="grid grid-cols-5 gap-2">
            <SummaryCard label="Rides"  value={String(data.summary.activities ?? 0)} />
            <SummaryCard label="km"     value={String(data.summary.km ?? 0)} />
            <SummaryCard label="Hours"  value={String(data.summary.hours ?? 0)} />
            <SummaryCard label="TSS"    value={String(data.summary.tss ?? 0)} />
            <SummaryCard label="Elev m" value={String(data.summary.elevation ?? 0)} />
          </div>
        ) : null}

        {/* Metric toggle */}
        <div className="flex gap-1.5 flex-wrap">
          {METRIC_OPTS.map(m => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                metric === m.key
                  ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                  : 'bg-gray-800 text-gray-500 hover:text-gray-300'
              }`}
            >
              {m.label}
            </button>
          ))}
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
                {/* Phantom zero-height bar sits at the top of every stack so the label always renders correctly */}
                <Bar dataKey={() => 0} stackId="a" fill="transparent" isAnimationActive={false} legendType="none">
                  <LabelList
                    dataKey={metric}
                    position="top"
                    formatter={(v: unknown) => barLabel(Number(v))}
                    style={{ fill: '#d1d5db', fontSize: 10, fontWeight: 500 }}
                  />
                </Bar>
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

      </div>
    </div>
  );
}
