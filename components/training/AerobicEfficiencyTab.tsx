'use client';

import { useState } from 'react';
import {
  ComposedChart, Scatter, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useCachedFetch } from '@/lib/use-cached-fetch';
import DurabilityCurveChart from './DurabilityCurveChart';

interface Ride {
  id:          number;
  date:        string;
  name:        string;
  np:          number;
  avg_watts:   number;
  avg_hr:      number;
  moving_time: number;
  vi:          number;
  ef_h1:       number;
  ef_h2:       number;
  pw_h1:       number;
  pw_h2:       number;
  hr_h1:       number;
  hr_h2:       number;
  decoupling:  number;
}

interface ScatterPoint extends Ride {
  x: number;   // epoch ms
  y: number;   // EF = np / avg_hr
}

interface TrendPoint {
  x: number;
  trendY: number;
}

const RANGES = [
  { key: '1m', label: '1 month'  },
  { key: '3m', label: '3 months' },
  { key: '6m', label: '6 months' },
];

function fmtDateShort(epochMs: number) {
  return new Date(epochMs).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

function linearRegression(pts: { x: number; y: number }[]) {
  const n = pts.length;
  if (n < 2) return null;
  const sumX  = pts.reduce((s, p) => s + p.x, 0);
  const sumY  = pts.reduce((s, p) => s + p.y, 0);
  const sumXY = pts.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = pts.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;
  const slope     = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function EfTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as ScatterPoint | undefined;
  if (!row) return null;
  const ef = row.np > 0 && row.avg_hr > 0 ? (row.np / row.avg_hr).toFixed(3) : '—';
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-lg space-y-0.5">
      <p className="text-gray-400">{new Date(row.x).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
      <p className="text-gray-300 truncate max-w-[200px] font-medium">{row.name}</p>
      <p className="text-orange-400 font-semibold pt-1">EF {ef}</p>
      <p className="text-[10px] text-gray-500">{row.np}W NP · {row.avg_hr} bpm</p>
    </div>
  );
}

export default function AerobicEfficiencyTab() {
  const [range, setRange] = useState('3m');
  const { data, loading, error } = useCachedFetch<{ rides: Ride[] }>(
    `/api/analytics/aerobic-efficiency?range=${range}`,
    `cache-aerobic-${range}`,
  );

  const rides = data?.rides ?? [];

  const scatterData: ScatterPoint[] = rides.map(r => ({
    ...r,
    x: new Date(r.date).getTime(),
    y: r.avg_hr > 0 ? Math.round((r.np / r.avg_hr) * 1000) / 1000 : 0,
  })).filter(p => p.y > 0);

  const reg = linearRegression(scatterData);
  const trendLineData: TrendPoint[] = reg && scatterData.length >= 2 ? [
    { x: scatterData[0].x,                    trendY: reg.slope * scatterData[0].x + reg.intercept },
    { x: scatterData[scatterData.length - 1].x, trendY: reg.slope * scatterData[scatterData.length - 1].x + reg.intercept },
  ] : [];

  const trendPct = trendLineData.length === 2 && trendLineData[0].trendY > 0
    ? ((trendLineData[1].trendY - trendLineData[0].trendY) / trendLineData[0].trendY) * 100
    : null;

  const avgDecoupling = rides.length
    ? rides.reduce((s, r) => s + r.decoupling, 0) / rides.length
    : 0;

  const rangeLabel = RANGES.find(r => r.key === range)?.label ?? range;

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
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gray-800/60 rounded-xl p-3 text-center">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Steady rides</p>
          <p className="text-2xl font-bold text-white">{scatterData.length}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">VI &lt; 1.05</p>
        </div>
        <div className="bg-gray-800/60 rounded-xl p-3 text-center">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Avg decoupling</p>
          <p className={`text-2xl font-bold ${avgDecoupling >= 5 ? 'text-red-400' : avgDecoupling >= 3 ? 'text-yellow-400' : 'text-green-400'}`}>
            {avgDecoupling.toFixed(1)}%
          </p>
          <p className="text-[10px] text-gray-500 mt-0.5">{avgDecoupling < 3 ? 'Good' : avgDecoupling < 5 ? 'OK' : 'Drift'}</p>
        </div>
        <div className="bg-gray-800/60 rounded-xl p-3 text-center">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">EF trend</p>
          {trendPct !== null ? (
            <>
              <p className={`text-2xl font-bold ${trendPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {trendPct >= 0 ? '+' : ''}{trendPct.toFixed(1)}%
              </p>
              <p className="text-[10px] text-gray-500 mt-0.5">{rangeLabel}</p>
            </>
          ) : (
            <p className="text-2xl font-bold text-gray-600">—</p>
          )}
        </div>
      </div>

      {/* EF Scatter chart */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="text-[11px] text-gray-600">
            Efficiency Factor (NP ÷ avg HR) per steady ride. Higher = better aerobic fitness.
          </p>
          {trendPct !== null && (
            <p className={`text-[11px] font-medium flex-shrink-0 ${trendPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {trendPct >= 0 ? '↑' : '↓'} {Math.abs(trendPct).toFixed(1)}% over {rangeLabel}
            </p>
          )}
        </div>

        {error ? (
          <div className="h-64 flex items-center justify-center text-red-400 text-sm">{error}</div>
        ) : loading && scatterData.length === 0 ? (
          <div className="h-64 animate-pulse bg-gray-800 rounded-lg" />
        ) : scatterData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-gray-500 text-sm text-center px-4">
            No steady rides (VI &lt; 1.05) with power + HR in this range
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
              <XAxis
                dataKey="x"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tick={{ fill: '#6b7280', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={fmtDateShort}
                tickCount={5}
              />
              <YAxis
                domain={['auto', 'auto']}
                tick={{ fill: '#6b7280', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={40}
                tickFormatter={v => v.toFixed(2)}
              />
              <Tooltip content={<EfTooltip />} cursor={{ strokeDasharray: '3 3', stroke: '#374151' }} />
              <Scatter
                data={scatterData}
                dataKey="y"
                fill="#f97316"
                opacity={0.8}
                isAnimationActive={false}
              />
              {trendLineData.length === 2 && (
                <Line
                  data={trendLineData}
                  dataKey="trendY"
                  stroke="#fb923c"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={false}
                  isAnimationActive={false}
                  legendType="none"
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}

        <p className="text-[10px] text-gray-600 mt-2 leading-relaxed">
          <span className="text-orange-400">●</span> Each dot = one steady ride ·
          <span className="text-orange-300 ml-1.5">- - -</span> Linear trend
        </p>
      </div>

      {/* Durability Curve */}
      <DurabilityCurveChart />
    </div>
  );
}
