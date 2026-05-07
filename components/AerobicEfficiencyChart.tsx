'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid,
  ReferenceLine, ReferenceArea,
  ResponsiveContainer, Tooltip,
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

const COMPARE_PERIODS = [
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
  { key: '6m',  label: '6m'  },
  { key: '1y',  label: '1yr' },
  { key: 'all', label: 'All' },
] as const;

type ComparePeriod = typeof COMPARE_PERIODS[number]['key'];

const COMPARE_LABELS: Record<ComparePeriod, string> = {
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '6m':  'Last 6 months',
  '1y':  'Last year',
  'all': 'All time',
};

function fmtDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-lg space-y-1">
      <p className="text-gray-400 font-medium">{label}</p>
      {p.watts != null && (
        <p className="text-orange-400">
          Power: <span className="font-bold">{p.watts} W</span>
        </p>
      )}
      {p.hr != null && (
        <p className="text-blue-400">
          HR: <span className="font-bold">{p.hr} bpm</span>
        </p>
      )}
      {p.ef != null && (
        <p className="text-white">
          EF: <span className="font-bold">{p.ef.toFixed(3)}</span>
        </p>
      )}
    </div>
  );
}

export default function AerobicEfficiencyChart({ activityId }: { activityId: string }) {
  const [data, setData] = useState<AerobicData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comparePeriod, setComparePeriod] = useState<ComparePeriod | null>(null);
  const [compareData, setCompareData] = useState<AerobicData | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);

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

  // Fetch comparison data when period changes
  useEffect(() => {
    if (!comparePeriod || !data) { setCompareData(null); return; }
    setCompareLoading(true);
    fetch(`/api/activities/${activityId}/aerobic-efficiency?compare=${comparePeriod}`)
      .then(r => r.json())
      .then((d: AerobicData & { error?: string }) => {
        if (!d.error) setCompareData(d);
        else setCompareData(null);
      })
      .catch(() => setCompareData(null))
      .finally(() => setCompareLoading(false));
  }, [activityId, comparePeriod, data]);

  const chartData = useMemo(() => {
    if (!data) return [];
    const n = data.watts.length;
    const secPerSample = data.sec_per_sample || 1;
    return Array.from({ length: n }, (_, i) => ({
      t:     Math.round((i * secPerSample) / 60),   // minutes
      watts: data.watts[i] ?? null,
      hr:    data.hr[i]    ?? null,
      ef:    (data.watts[i] != null && data.hr[i] != null && data.hr[i]! > 0) 
        ? data.watts[i]! / data.hr[i]! 
        : null,
    }));
  }, [data]);

  const compareChartData = useMemo(() => {
    if (!compareData) return [];
    const n = compareData.watts.length;
    const secPerSample = compareData.sec_per_sample || 1;
    return Array.from({ length: n }, (_, i) => ({
      t:     Math.round((i * secPerSample) / 60),
      watts: compareData.watts[i] ?? null,
      hr:    compareData.hr[i]    ?? null,
      ef:    (compareData.watts[i] != null && compareData.hr[i] != null && compareData.hr[i]! > 0)
        ? compareData.watts[i]! / compareData.hr[i]!
        : null,
    }));
  }, [compareData]);

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

  // Compute EF domain for Y-axis
  const allEf = chartData.filter(d => d.ef != null).map(d => d.ef as number);
  const efMin = allEf.length > 0 ? Math.floor(Math.min(...allEf) * 1000) / 1000 : 0;
  const efMax = allEf.length > 0 ? Math.ceil(Math.max(...allEf) * 1000) / 1000 : 1;
  const efPadding = Math.max((efMax - efMin) * 0.15, 0.05);
  const efDomain: [number, number] = [
    Math.max(0, efMin - efPadding),
    efMax + efPadding,
  ];

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-4">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Efficiency Graph
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

      {/* Efficiency Graph */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] text-gray-500 uppercase tracking-wider">Efficiency Graph</p>
          {/* Compare period selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-gray-600">Compare vs:</span>
            {COMPARE_PERIODS.map(p => (
              <button
                key={p.key}
                onClick={() => setComparePeriod(prev => prev === p.key ? null : p.key)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors border ${
                  comparePeriod === p.key
                    ? 'bg-blue-500/20 text-blue-400 border-blue-500/50'
                    : 'bg-gray-800 text-gray-500 hover:text-gray-300 border-transparent'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {chartData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-gray-500 text-sm">No stream data</div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={220}>
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
                  width={36}
                  tickFormatter={v => `${v}`}
                />
                {/* EF Y-axis (far right) */}
                <YAxis
                  yAxisId="ef"
                  orientation="right"
                  domain={efDomain}
                  tick={{ fill: '#ffffff', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                  tickFormatter={v => v.toFixed(2)}
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
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#374151', strokeWidth: 1 }} />
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
                <Line
                  yAxisId="ef"
                  dataKey="ef"
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                  opacity={0.7}
                />
                {/* Comparison overlay lines */}
                {compareChartData.length > 0 && (
                  <>
                    <Line
                      yAxisId="w"
                      data={compareChartData}
                      dataKey="watts"
                      stroke="#f97316"
                      strokeWidth={1}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls
                      strokeDasharray="4 3"
                      opacity={0.5}
                    />
                    <Line
                      yAxisId="hr"
                      data={compareChartData}
                      dataKey="hr"
                      stroke="#60a5fa"
                      strokeWidth={1}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls
                      strokeDasharray="4 3"
                      opacity={0.5}
                    />
                    <Line
                      yAxisId="ef"
                      data={compareChartData}
                      dataKey="ef"
                      stroke="#ffffff"
                      strokeWidth={1}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls
                      strokeDasharray="4 3"
                      opacity={0.35}
                    />
                  </>
                )}
              </LineChart>
            </ResponsiveContainer>
            <p className="text-[10px] text-gray-600 mt-2">
              <span className="text-orange-400">—</span> Power (W) ·
              <span className="text-blue-400 ml-1.5">—</span> Heart rate (bpm) ·
              <span className="text-white ml-1.5">—</span> EF
              {comparePeriod && compareChartData.length > 0 && (
                <span className="text-gray-500 ml-1.5">· <span className="opacity-50">- -</span> {COMPARE_LABELS[comparePeriod]}</span>
              )}
              <span className="ml-3 text-gray-600">· First half shaded</span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
