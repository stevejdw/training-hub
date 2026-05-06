'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid,
  ReferenceLine, ReferenceArea,
  ResponsiveContainer,
} from 'recharts';

interface AerobicData {
  name: string;
  date: string;
  moving_time: number;
  avg_watts: number;
  avg_hr: number;
  np: number;
  n_samples: number;
  sec_per_sample: number;
  watts: (number | null)[];
  hr: (number | null)[];
  pw_h1: number;
  pw_h2: number;
  hr_h1: number;
  hr_h2: number;
  ef_h1: number;
  ef_h2: number;
  decoupling: number;
}

function fmtDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function AerobicEfficiencyChart({ activityId }: { activityId: string }) {
  const [data, setData] = useState<AerobicData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/activities/${activityId}/aerobic-efficiency`)
      .then(r => r.json())
      .then((d: AerobicData & { error?: string }) => {
        if (d.error) { setError(d.error); } else { setData(d); }
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [activityId]);

  const chartData = useMemo(() => {
    if (!data) return [];
    const n = data.watts.length;
    const secPerSample = data.sec_per_sample || 1;
    return Array.from({ length: n }, (_, i) => ({
      t:     Math.round((i * secPerSample) / 60),   // minutes
      watts: data.watts[i] ?? null,
      hr:    data.hr[i]    ?? null,
    }));
  }, [data]);

  const halfMin = data ? Math.round((data.moving_time / 2) / 60) : 0;

  if (loading) {
    return <div className="h-64 bg-gray-800 rounded-xl animate-pulse" />;
  }

  if (error || !data) {
    return (
      <div className="bg-gray-800/50 border border-gray-700 border-dashed rounded-xl p-6 text-center">
        <p className="text-gray-500 text-sm">
          {error === 'Activity not found or missing streams'
            ? 'No power & HR stream data for this activity'
            : 'Unable to load aerobic efficiency data'}
        </p>
      </div>
    );
  }

  const ef = data.np > 0 && data.avg_hr > 0 ? (data.np / data.avg_hr).toFixed(3) : '—';

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-4">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Aerobic Efficiency
        </p>
        <p className="text-[11px] text-gray-600 mt-1">
          First half vs second half comparison — measures aerobic decoupling (cardiac drift)
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Duration', value: fmtDuration(data.moving_time) },
          { label: 'NP', value: `${data.np}W` },
          { label: 'Avg HR', value: `${data.avg_hr} bpm` },
          { label: 'EF', value: ef },
        ].map(s => (
          <div key={s.label} className="bg-gray-800/60 rounded-xl p-2.5 text-center">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">{s.label}</p>
            <p className="text-base font-bold text-white mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Half-split comparison */}
      <div>
        <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-2">First vs Second Half</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'First half', watts: data.pw_h1, hr: data.hr_h1, ef: data.ef_h1 },
            { label: 'Second half', watts: data.pw_h2, hr: data.hr_h2, ef: data.ef_h2 },
          ].map(h => (
            <div key={h.label} className="bg-gray-800/60 rounded-xl p-3">
              <p className="text-[10px] text-gray-500 mb-2">{h.label}</p>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Avg watts</span>
                  <span className="text-orange-400 font-medium">{h.watts}W</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Avg HR</span>
                  <span className="text-blue-400 font-medium">{h.hr} bpm</span>
                </div>
                <div className="flex justify-between text-xs pt-1 border-t border-gray-700/50">
                  <span className="text-gray-500">EF</span>
                  <span className="text-white font-semibold">{h.ef.toFixed(3)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-gray-500">Aerobic decoupling</p>
          <p className={`text-sm font-bold ${data.decoupling >= 5 ? 'text-red-400' : data.decoupling >= 3 ? 'text-yellow-400' : 'text-green-400'}`}>
            {data.decoupling >= 0 ? '+' : ''}{data.decoupling.toFixed(1)}%
            <span className="text-[10px] font-normal text-gray-500 ml-1.5">
              {data.decoupling < 3 ? 'Excellent' : data.decoupling < 5 ? 'Acceptable' : 'Drift detected'}
            </span>
          </p>
        </div>
      </div>

      {/* Power / HR time series chart */}
      <div>
        <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-3">Power & HR Over Ride</p>
        {chartData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-gray-500 text-sm">No stream data</div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                <XAxis
                  dataKey="t"
                  tick={{ fill: '#6b7280', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => `${v}m`}
                  tickCount={6}
                />
                {/* Watts Y-axis (left) */}
                <YAxis
                  yAxisId="w"
                  domain={['auto', 'auto']}
                  tick={{ fill: '#f97316', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                  tickFormatter={v => `${v}W`}
                />
                {/* HR Y-axis (right) */}
                <YAxis
                  yAxisId="hr"
                  orientation="right"
                  domain={['auto', 'auto']}
                  tick={{ fill: '#60a5fa', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                  tickFormatter={v => `${v}`}
                />
                {/* Shade first vs second half */}
                {halfMin > 0 && (
                  <ReferenceArea
                    yAxisId="w"
                    x1={0}
                    x2={halfMin}
                    fill="#f97316"
                    fillOpacity={0.04}
                    stroke="none"
                  />
                )}
                {halfMin > 0 && (
                  <ReferenceLine
                    yAxisId="w"
                    x={halfMin}
                    stroke="#374151"
                    strokeDasharray="4 3"
                    label={{ value: 'Half', fill: '#6b7280', fontSize: 9, position: 'insideTopRight' }}
                  />
                )}
                <Line
                  yAxisId="w"
                  dataKey="watts"
                  stroke="#f97316"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
                <Line
                  yAxisId="hr"
                  dataKey="hr"
                  stroke="#60a5fa"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-[10px] text-gray-600 mt-2">
              <span className="text-orange-400">—</span> Power (W) ·
              <span className="text-blue-400 ml-1.5">—</span> Heart rate (bpm)
              <span className="ml-3 text-gray-600">· First half shaded</span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
