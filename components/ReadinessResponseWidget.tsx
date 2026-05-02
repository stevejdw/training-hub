'use client';

import Link from 'next/link';
import {
  ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceArea, ResponsiveContainer,
} from 'recharts';
import { useCachedFetch } from '@/lib/use-cached-fetch';

interface DataPoint {
  date:   string;
  tss:    number | null;
  hrv:    number | null;  // generic: holds HRV, resting HR, or sleep score depending on metricKey
  status: 'green' | 'warning' | 'neutral' | null;
}

interface ReadinessData {
  data:                DataPoint[];
  hrvBaseline:         { mean: number; stdDev: number } | null;
  intervalsConfigured: boolean;
  metricKey:           'hrv' | 'rhr' | 'sleep' | null;
  metricLabel:         string | null;
  metricUnit:          string | null;
}

const STATUS_CONFIG = {
  green:   { label: 'Balanced',        textColor: 'text-green-400',  bg: 'bg-green-400/10 border-green-500/30'  },
  warning: { label: 'Recovery Needed', textColor: 'text-red-400',    bg: 'bg-red-400/10 border-red-500/30'      },
  neutral: { label: 'Neutral',         textColor: 'text-gray-400',   bg: 'bg-gray-400/10 border-gray-500/30'    },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ReadinessTooltip({ active, payload, baseline, metricLabel, metricUnit, invertedMetric }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as DataPoint;
  const tssEntry = payload.find((p: any) => p.dataKey === 'tss');
  const metricEntry = payload.find((p: any) => p.dataKey === 'hrv');
  const inRange = d.hrv != null && baseline
    ? d.hrv >= baseline.mean - baseline.stdDev && d.hrv <= baseline.mean + baseline.stdDev
    : null;
  const outOfRangeLabel = invertedMetric ? ' ↑ elevated' : ' ↓ below normal';

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-lg space-y-0.5">
      <p className="text-gray-400">{new Date(d.date + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</p>
      {tssEntry?.value != null && (
        <p className="text-gray-300">{Math.round(tssEntry.value)} TSS</p>
      )}
      {metricEntry?.value != null && (
        <p className={`font-semibold ${inRange ? 'text-green-400' : d.status === 'warning' ? 'text-red-400' : 'text-blue-400'}`}>
          {metricEntry.value.toFixed(1)}{metricUnit ? ` ${metricUnit}` : ''} {metricLabel}
          {inRange === false ? outOfRangeLabel : ''}
        </p>
      )}
    </div>
  );
}

export default function ReadinessResponseWidget() {
  const { data: resp, loading, error } = useCachedFetch<ReadinessData>(
    '/api/analytics/readiness-response',
    'cache-readiness-response',
  );

  if (loading && !resp) {
    return <div className="h-48 animate-pulse bg-gray-800/60 rounded-2xl" />;
  }

  if (error) {
    return null;
  }

  if (!resp?.intervalsConfigured) {
    return (
      <div className="bg-gray-800/60 rounded-2xl p-4 border border-gray-700/40">
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Readiness &amp; Response</p>
        <p className="text-sm text-gray-500">
          Connect intervals.icu in{' '}
          <Link href="/settings" className="text-orange-400 hover:text-orange-300 underline underline-offset-2 transition-colors">
            Settings
          </Link>{' '}
          to see how your recovery metrics respond to training load.
        </p>
      </div>
    );
  }

  if (!resp.data.length || !resp.metricKey) {
    return (
      <div className="bg-gray-800/60 rounded-2xl p-4 border border-gray-700/40">
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Readiness &amp; Response</p>
        <p className="text-sm text-gray-500">
          No wellness data yet.{' '}
          <Link href="/settings" className="text-orange-400 hover:text-orange-300 underline underline-offset-2 transition-colors">
            Sync intervals.icu
          </Link>{' '}
          to get started.
        </p>
      </div>
    );
  }

  const displayData     = resp.data.slice(-30);
  const baseline        = resp.hrvBaseline;
  const metricLabel     = resp.metricLabel ?? 'Recovery';
  const metricUnit      = resp.metricUnit ?? '';
  const invertedMetric  = resp.metricKey === 'rhr';
  const latest          = displayData[displayData.length - 1];
  const status          = latest?.status ?? 'neutral';
  const statusCfg       = STATUS_CONFIG[status] ?? STATUS_CONFIG.neutral;

  return (
    <div className="bg-gray-800/60 rounded-2xl p-4 border border-gray-700/40">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Readiness &amp; Response</p>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusCfg.bg} ${statusCfg.textColor}`}>
          {statusCfg.label}
        </span>
      </div>

      <ResponsiveContainer width="100%" height={160}>
        <ComposedChart data={displayData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: '#6b7280', fontSize: 9 }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            tickFormatter={v => new Date(v + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
          />
          <YAxis
            yAxisId="tss"
            orientation="left"
            tick={{ fill: '#6b7280', fontSize: 9 }}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          <YAxis
            yAxisId="hrv"
            orientation="right"
            tick={{ fill: '#60a5fa', fontSize: 9 }}
            axisLine={false}
            tickLine={false}
            width={32}
            domain={['auto', 'auto']}
            // Invert axis for resting HR so "worse" (higher bpm) goes up visually
            reversed={invertedMetric}
          />
          <Tooltip
            content={
              <ReadinessTooltip
                baseline={baseline}
                metricLabel={metricLabel}
                metricUnit={metricUnit}
                invertedMetric={invertedMetric}
              />
            }
            cursor={{ fill: 'rgba(255,255,255,0.03)' }}
          />

          {baseline && (
            <ReferenceArea
              yAxisId="hrv"
              y1={baseline.mean - baseline.stdDev}
              y2={baseline.mean + baseline.stdDev}
              fill="#34d399"
              fillOpacity={0.07}
              strokeOpacity={0}
            />
          )}

          <Bar
            yAxisId="tss"
            dataKey="tss"
            fill="#374151"
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
            maxBarSize={10}
          />
          <Line
            yAxisId="hrv"
            type="monotone"
            dataKey="hrv"
            stroke="#60a5fa"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, fill: '#60a5fa' }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      <div className="mt-2">
        <p className="text-[10px] text-gray-600">
          <span className="text-gray-500">▪</span> TSS (left) ·
          <span className="text-blue-400 ml-1">—</span> {metricLabel}{metricUnit ? ` (${metricUnit})` : ''} (right)
          {baseline && <span className="ml-1 text-green-400/60">· shaded = normal range</span>}
        </p>
        {resp.metricKey !== 'hrv' && (
          <p className="text-[10px] text-gray-600 mt-0.5">
            Using {metricLabel} — HRV not available from your intervals.icu data
          </p>
        )}
      </div>
    </div>
  );
}
