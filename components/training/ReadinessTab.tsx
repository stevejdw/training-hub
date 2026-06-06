'use client';

import { useState } from 'react';
import {
  ComposedChart, Line, ReferenceArea, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useCachedFetch } from '@/lib/use-cached-fetch';
import EnlargeableChart from '@/components/EnlargeableChart';
import type { ReadinessResponse, ReadinessPoint } from '@/app/api/analytics/readiness/route';

type ChartPeriod = '3m' | '6m' | '1y';
const CHART_PERIODS: { key: ChartPeriod; label: string; days: number }[] = [
  { key: '3m', label: '3m', days: 90  },
  { key: '6m', label: '6m', days: 180 },
  { key: '1y', label: '1y', days: 365 },
];

function getWindow<T extends { date: string }>(allPoints: T[], period: ChartPeriod, offset: number): T[] {
  if (allPoints.length === 0) return allPoints;
  const periodDays = CHART_PERIODS.find(p => p.key === period)!.days;
  const endMs   = Date.now() - offset * periodDays * 86400000;
  const startMs = endMs - periodDays * 86400000;
  const endDate   = new Date(endMs).toISOString().slice(0, 10);
  const startDate = new Date(startMs).toISOString().slice(0, 10);
  return allPoints.filter(p => p.date >= startDate && p.date <= endDate);
}

function canGoBack<T extends { date: string }>(allPoints: T[], period: ChartPeriod, offset: number): boolean {
  const periodDays  = CHART_PERIODS.find(p => p.key === period)!.days;
  const windowStart = new Date(Date.now() - (offset + 1) * periodDays * 86400000).toISOString().slice(0, 10);
  return allPoints.some(p => p.date < windowStart);
}

interface ChartNavProps {
  period:    ChartPeriod;
  offset:    number;
  hasBack:   boolean;
  setPeriod: (p: ChartPeriod) => void;
  setOffset: (fn: (o: number) => number) => void;
}

function ChartNav({ period, offset, hasBack, setPeriod, setOffset }: ChartNavProps) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex bg-gray-800 rounded-lg p-0.5 gap-0.5">
        {CHART_PERIODS.map(p => (
          <button key={p.key} onClick={() => { setPeriod(p.key); setOffset(() => 0); }}
            className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
              period === p.key ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-white'
            }`}>
            {p.label}
          </button>
        ))}
      </div>
      <button onClick={() => setOffset(o => o + 1)} disabled={!hasBack}
        className="p-1 rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <button onClick={() => setOffset(o => Math.max(0, o - 1))} disabled={offset === 0}
        className="p-1 rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ReadinessTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload as ReadinessPoint | undefined;
  if (!p) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-lg space-y-1">
      <p className="text-gray-400">{fmtDate(String(label))}</p>
      {p.hrv !== null && (
        <p className="text-green-400 font-semibold">{p.hrv} ms <span className="text-gray-500 font-normal">HRV (rMSSD)</span></p>
      )}
      {p.readiness_score !== null && (
        <p className="text-blue-400">{p.readiness_score} <span className="text-gray-500">readiness</span></p>
      )}
      {p.sleep_score !== null && (
        <p className="text-purple-400">{p.sleep_score} <span className="text-gray-500">sleep</span></p>
      )}
      {p.resting_hr !== null && (
        <p className="text-red-400">{p.resting_hr} bpm <span className="text-gray-500">resting HR</span></p>
      )}
    </div>
  );
}

export default function ReadinessTab() {
  const [period, setPeriod] = useState<ChartPeriod>('3m');
  const [offset, setOffset] = useState(0);

  // Fetch 1y of data once; window client-side for instant back/forward navigation
  const { data, loading } = useCachedFetch<ReadinessResponse>(
    '/api/analytics/readiness?days=365',
    'cache-readiness-365',
  );

  const allPoints = data?.points ?? [];
  const zone      = data?.zone   ?? null;
  const fatigue   = data?.fatigue_alert ?? false;

  const points = getWindow(allPoints, period, offset);
  const latest = points[points.length - 1] ?? null;

  const hasData = points.some(p => p.hrv !== null);

  return (
    <div className="space-y-3">
      {/* Fatigue alert */}
      {fatigue && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-medium">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          HRV below normal zone for 3+ days — consider prioritising recovery
        </div>
      )}

      {/* Summary cards */}
      {latest && hasData && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gray-800/60 rounded-xl p-3 text-center">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">HRV (rMSSD)</p>
            <p className="text-2xl font-bold text-green-400">{latest.hrv ?? '—'}</p>
            {zone && latest.hrv !== null && (
              <p className={`text-[10px] mt-0.5 ${
                latest.hrv >= zone.upper ? 'text-green-400' :
                latest.hrv >= zone.lower ? 'text-gray-400'  : 'text-red-400'
              }`}>
                {latest.hrv >= zone.upper ? 'Above zone' :
                 latest.hrv >= zone.lower ? 'Normal'      : 'Below zone'}
              </p>
            )}
          </div>
          <div className="bg-gray-800/60 rounded-xl p-3 text-center">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Readiness</p>
            <p className="text-2xl font-bold text-blue-400">{latest.readiness_score ?? '—'}</p>
          </div>
          <div className="bg-gray-800/60 rounded-xl p-3 text-center">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Sleep</p>
            <p className="text-2xl font-bold text-purple-400">{latest.sleep_score ?? '—'}</p>
          </div>
        </div>
      )}

      {/* Chart */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Daily HRV vs Normal Zone</p>
          <ChartNav
            period={period} offset={offset}
            hasBack={canGoBack(allPoints, period, offset)}
            setPeriod={setPeriod} setOffset={setOffset}
          />
        </div>
        {zone && (
          <p className="text-[11px] text-gray-600 mb-3">
            Normal zone: {zone.lower}–{zone.upper} ms &nbsp;·&nbsp; baseline avg {zone.avg} ms
          </p>
        )}

        {loading && points.length === 0 ? (
          <div className="h-64 animate-pulse bg-gray-800 rounded-lg" />
        ) : !hasData ? (
          <div className="h-64 flex flex-col items-center justify-center gap-3 text-center px-6">
            <p className="text-gray-400 text-sm font-medium">No HRV data yet</p>
            <p className="text-gray-600 text-xs">
              Add your intervals.icu Athlete ID and API Key in{' '}
              <a href="/settings" className="text-orange-400 underline underline-offset-2">Settings</a>{' '}
              and sync to populate this chart.
            </p>
          </div>
        ) : (
          <EnlargeableChart title="Daily HRV vs Normal Zone" subtitle={zone ? `Normal zone: ${zone.lower}–${zone.upper} ms · baseline avg ${zone.avg} ms` : undefined}>{(fs) => (
          <ResponsiveContainer width="100%" height={fs ? '100%' : 260}>
            <ComposedChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: '#6b7280', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                tickFormatter={fmtDate}
              />
              {/* Left axis — HRV (ms) */}
              <YAxis
                yAxisId="hrv"
                tick={{ fill: '#6b7280', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={32}
                domain={['auto', 'auto']}
              />
              {/* Right axis — Readiness (0–100) */}
              <YAxis
                yAxisId="readiness"
                orientation="right"
                tick={{ fill: '#3b82f6', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={32}
                domain={[0, 100]}
              />
              <Tooltip content={<ReadinessTooltip />} cursor={{ stroke: '#374151', strokeWidth: 1 }} />
              <Legend
                iconSize={8}
                formatter={value => (
                  <span style={{ color: '#9ca3af', fontSize: 10 }}>
                    {value === 'hrv' ? 'HRV (rMSSD)' : 'Readiness'}
                  </span>
                )}
              />

              {/* Normal zone band */}
              {zone && (
                <ReferenceArea
                  yAxisId="hrv"
                  y1={zone.lower}
                  y2={zone.upper}
                  fill="#34d399"
                  fillOpacity={0.08}
                  strokeOpacity={0}
                />
              )}
              {/* Baseline average line */}
              {zone && (
                <ReferenceLine
                  yAxisId="hrv"
                  y={zone.avg}
                  stroke="#34d399"
                  strokeOpacity={0.4}
                  strokeDasharray="4 3"
                />
              )}

              {/* Daily HRV dots + line */}
              <Line
                yAxisId="hrv"
                type="monotone"
                dataKey="hrv"
                name="hrv"
                stroke="#9ca3af"
                strokeWidth={1.5}
                dot={{ fill: '#9ca3af', r: 3, strokeWidth: 0 }}
                activeDot={{ r: 5, fill: '#34d399' }}
                connectNulls={false}
                isAnimationActive={false}
              />

              {/* Daily Readiness score line */}
              <Line
                yAxisId="readiness"
                type="monotone"
                dataKey="readiness_score"
                name="readiness"
                stroke="#3b82f6"
                strokeWidth={1.5}
                dot={{ fill: '#3b82f6', r: 3, strokeWidth: 0 }}
                activeDot={{ r: 5, fill: '#60a5fa' }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
          )}</EnlargeableChart>
        )}
      </div>

      {/* Legend explainer */}
      {hasData && (
        <div className="grid grid-cols-3 gap-2 text-xs text-gray-500">
          <div><span className="text-gray-300 font-medium">HRV</span> — Heart Rate Variability (rMSSD, ms). Higher = more recovered.</div>
          <div><span className="text-green-400 font-medium">Band</span> — Your normal zone (baseline avg ± 1σ). Below = stress signal.</div>
          <div><span className="text-blue-400 font-medium">Readiness</span> — composite score (0–100) from HRV, sleep & RHR.</div>
        </div>
      )}
    </div>
  );
}
