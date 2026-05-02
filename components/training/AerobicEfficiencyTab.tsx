'use client';

import { useState } from 'react';
import {
  ComposedChart, Line, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import { useCachedFetch } from '@/lib/use-cached-fetch';

interface Ride {
  id:         number;
  date:       string;
  name:       string;
  np:         number;
  avg_watts:  number;
  avg_hr:     number;
  vi:         number;
  ef_h1:      number;
  ef_h2:      number;
  pw_h1:      number;
  pw_h2:      number;
  hr_h1:      number;
  hr_h2:      number;
  decoupling: number;
}

const RANGES: { key: string; label: string }[] = [
  { key: '90d',  label: '90 days'  },
  { key: '180d', label: '6 months' },
  { key: '365d', label: '1 year'   },
  { key: 'all',  label: 'All time' },
];

const HIGH_DECOUPLING = 5;

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function EfTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Ride | undefined;
  if (!row) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-lg space-y-0.5">
      <p className="text-gray-400">{fmtDate(String(label))}</p>
      <p className="text-gray-300 truncate max-w-[200px]">{row.name}</p>
      <p className="text-orange-400 font-medium">{row.np} W <span className="text-gray-500">NP</span></p>
      <p className="text-red-400 font-medium">{row.avg_hr} bpm <span className="text-gray-500">avg HR</span></p>
      <p className="text-gray-400">VI {row.vi.toFixed(2)}</p>
      <p className={`font-semibold pt-1 mt-1 border-t border-gray-700 ${
        row.decoupling >= HIGH_DECOUPLING ? 'text-red-400' :
        row.decoupling >= 3              ? 'text-yellow-400' : 'text-green-400'
      }`}>
        Decoupling: {row.decoupling.toFixed(1)}%
      </p>
      <p className="text-[10px] text-gray-500">
        H1: {row.pw_h1}W / {row.hr_h1}bpm · H2: {row.pw_h2}W / {row.hr_h2}bpm
      </p>
    </div>
  );
}

export default function AerobicEfficiencyTab() {
  const [range, setRange] = useState('90d');
  const { data, loading, error } = useCachedFetch<{ rides: Ride[] }>(
    `/api/analytics/aerobic-efficiency?range=${range}`,
    `cache-aerobic-${range}`,
  );

  const rides = data?.rides ?? [];

  // Build chart rows. Power line uses NP. HR line uses avg HR.
  // The "drift" band is plotted between min(pw_h1, pw_h2) and max(pw_h1, pw_h2)
  // on the power axis, shaded translucent red — wider gap = more decoupling.
  // We render this as two stacked areas (transparent base + red band) so
  // gridlines remain visible underneath.
  const chartData = rides.map(r => {
    const lo = Math.min(r.pw_h1, r.pw_h2);
    const hi = Math.max(r.pw_h1, r.pw_h2);
    return {
      ...r,
      drift_base: lo,
      drift_band: hi - lo,
    };
  });

  const avgDecoupling = rides.length
    ? rides.reduce((s, r) => s + r.decoupling, 0) / rides.length
    : 0;

  const decouplingColor =
    avgDecoupling >= HIGH_DECOUPLING ? 'text-red-400' :
    avgDecoupling >= 3              ? 'text-yellow-400' : 'text-green-400';

  return (
    <div className="space-y-3">
      {/* Range selector */}
      <div className="flex gap-1.5 flex-wrap">
        {RANGES.map(r => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              range === r.key
                ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                : 'bg-gray-800 text-gray-500 hover:text-gray-300'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-gray-800/60 rounded-xl p-3 text-center">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Steady rides</p>
          <p className="text-2xl font-bold text-white">{rides.length}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">VI &lt; 1.05</p>
        </div>
        <div className="bg-gray-800/60 rounded-xl p-3 text-center">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Avg decoupling</p>
          <p className={`text-2xl font-bold ${decouplingColor}`}>{avgDecoupling.toFixed(1)}%</p>
          <p className="text-[10px] text-gray-500 mt-0.5">{avgDecoupling < 3 ? 'Good' : avgDecoupling < HIGH_DECOUPLING ? 'OK' : 'Drift'}</p>
        </div>
      </div>

      {/* Dual-axis chart */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
        <p className="text-[11px] text-gray-600 mb-3">
          Power (W) on left, HR (bpm) on right. Red shaded band = drift between first &amp; second-half power, indicating cardiac decoupling.
        </p>
        {error ? (
          <div className="h-64 flex items-center justify-center text-red-400 text-sm">{error}</div>
        ) : loading && rides.length === 0 ? (
          <div className="h-64 animate-pulse bg-gray-800 rounded-lg" />
        ) : rides.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-gray-500 text-sm text-center px-4">
            No steady rides (VI &lt; 1.05) with power + HR streams in this range
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: '#6b7280', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                tickFormatter={fmtDate}
              />
              <YAxis
                yAxisId="power"
                orientation="left"
                tick={{ fill: '#f97316', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={36}
                tickFormatter={(v) => `${v}W`}
              />
              <YAxis
                yAxisId="hr"
                orientation="right"
                tick={{ fill: '#ef4444', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={36}
                tickFormatter={(v) => `${v}`}
              />
              <Tooltip content={<EfTooltip />} cursor={{ stroke: '#374151', strokeWidth: 1 }} />
              <Legend
                formatter={value => {
                  const label = value === 'np' ? 'Power (NP)'
                              : value === 'avg_hr' ? 'Avg HR'
                              : value === 'drift_high' ? 'H1↔H2 drift' : value;
                  return <span style={{ color: '#9ca3af', fontSize: 11 }}>{label}</span>;
                }}
                iconType="line"
              />

              {/* Stacked drift band — invisible base + translucent red top
                  so the visible red sits between pw_h1 and pw_h2 */}
              <Area
                yAxisId="power"
                type="monotone"
                dataKey="drift_base"
                stackId="drift"
                stroke="none"
                fill="transparent"
                isAnimationActive={false}
                legendType="none"
              />
              <Area
                yAxisId="power"
                type="monotone"
                dataKey="drift_band"
                stackId="drift"
                stroke="none"
                fill="#ef4444"
                fillOpacity={0.22}
                isAnimationActive={false}
                legendType="none"
              />

              {/* Power line (left axis, solid orange) */}
              <Line
                yAxisId="power"
                type="monotone"
                dataKey="np"
                name="np"
                stroke="#f97316"
                strokeWidth={2.5}
                dot={{ fill: '#f97316', r: 3, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
                connectNulls={false}
              />

              {/* HR line (right axis, red) */}
              <Line
                yAxisId="hr"
                type="monotone"
                dataKey="avg_hr"
                name="avg_hr"
                stroke="#ef4444"
                strokeWidth={2}
                dot={{ fill: '#ef4444', r: 3, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}

        <p className="text-[10px] text-gray-600 mt-2 leading-relaxed">
          <span className="text-green-400">&lt; 3%</span> = excellent aerobic base ·
          <span className="text-yellow-400 ml-1.5">3–5%</span> = acceptable ·
          <span className="text-red-400 ml-1.5">&gt; 5%</span> = drift (fatigue / weak base)
        </p>
      </div>
    </div>
  );
}
