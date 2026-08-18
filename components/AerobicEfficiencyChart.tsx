'use client';

import { useEffect, useState, useMemo } from 'react';
import { rollingMean } from '@/lib/smooth';
import { CHART } from '@/lib/chart-theme';
import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid,
  ReferenceLine, ReferenceArea,
  ResponsiveContainer, Tooltip,
} from 'recharts';
import EnlargeableChart from '@/components/EnlargeableChart';

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
    <div className="bg-surface border border-line-strong rounded-lg px-3 py-2 text-xs shadow-lg space-y-1">
      <p className="text-ink-3 font-medium">{label}</p>
      {p.watts != null && (
        <p className="text-accent-hi">
          Power: <span className="font-bold">{p.watts} W</span>
        </p>
      )}
      {p.hr != null && (
        <p className="text-blue-400">
          HR: <span className="font-bold">{p.hr} bpm</span>
        </p>
      )}
      {p.ef != null && (
        <p className="text-ink">
          EF: <span className="font-bold">{p.ef.toFixed(3)}</span>
        </p>
      )}
    </div>
  );
}

export default function AerobicEfficiencyChart({ activityId, showCompare }: { activityId: string; showCompare?: boolean }) {
  const [data, setData] = useState<AerobicData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comparePeriod, setComparePeriod] = useState<ComparePeriod | null>(null);
  const [compareData, setCompareData] = useState<AerobicData | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  /* EF alone by default. Power and HR are context, and at equal weight they
     buried the line the chart exists to show. */
  const [showPower, setShowPower] = useState(false);
  const [showHr, setShowHr] = useState(false);
  const [showEf, setShowEf] = useState(true);

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

    const rawEf = Array.from({ length: n }, (_, i) =>
      (data.watts[i] != null && data.hr[i] != null && data.hr[i]! > 0)
        ? data.watts[i]! / data.hr[i]!
        : null);

    /* Smoothed: instantaneous W/HR is far too spiky to read drift from — a
       one-second power blip swings efficiency wildly. EF gets the wider
       window because it is the subject of the chart. */
    const ef    = rollingMean(rawEf, 30);
    const watts = rollingMean(data.watts.map(v => v ?? null), 10);
    const hr    = rollingMean(data.hr.map(v => v ?? null), 10);

    return Array.from({ length: n }, (_, i) => ({
      t:     Math.round((i * secPerSample) / 60),   // minutes
      watts: watts[i],
      hr:    hr[i],
      ef:    ef[i],
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

  // Array midpoint, deliberately NOT moving_time/2: the API splits decoupling
  // at Math.floor(n/2) of the raw sample array, so this keeps the shaded half
  // aligned with the ef_h1 / ef_h2 figures shown above the chart.
  const halfMin = chartData.length > 0
    ? chartData[Math.floor(chartData.length / 2)].t
    : 0;


  if (loading) {
    return <div className="h-64 bg-raised rounded-xl animate-pulse" />;
  }

  if (error || !data) {
    return (
      <div className="bg-raised/50 border border-line-strong border-dashed rounded-xl p-6 text-center">
        <p className="text-ink-4 text-sm">
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
    <div className="bg-surface border border-line rounded-2xl p-4 space-y-4">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold text-ink-4 uppercase tracking-wider">
          Efficiency Graph
        </p>
        <p className="text-mini text-ink-5 mt-1">
          First half vs second half comparison — measures aerobic decoupling (cardiac drift)
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-5 gap-2">
        {[
          { label: 'Duration', value: fmtDuration(data.moving_time) },
          { label: 'Avg Power', value: `${data.avg_watts}W` },
          { label: 'NP', value: `${data.np}W` },
          { label: 'Avg HR', value: `${data.avg_hr} bpm` },
          { label: 'EF', value: ef },
        ].map(s => (
          <div key={s.label} className="bg-raised/60 rounded-xl p-2.5 text-center">
            <p className="text-micro text-ink-4 uppercase tracking-wider">{s.label}</p>
            <p className="text-base font-bold text-ink mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Half-split comparison */}
      <div>
        <p className="text-mini text-ink-4 uppercase tracking-wider mb-2">First vs Second Half</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'First half', watts: data.pw_h1, hr: data.hr_h1, ef: data.ef_h1 },
            { label: 'Second half', watts: data.pw_h2, hr: data.hr_h2, ef: data.ef_h2 },
          ].map(h => (
            <div key={h.label} className="bg-raised/60 rounded-xl p-3">
              <p className="text-micro text-ink-4 mb-2">{h.label}</p>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-ink-4">Avg watts</span>
                  <span className="text-accent-hi font-medium">{h.watts}W</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-ink-4">Avg HR</span>
                  <span className="text-blue-400 font-medium">{h.hr} bpm</span>
                </div>
                <div className="flex justify-between text-xs pt-1 border-t border-line-strong/50">
                  <span className="text-ink-4">EF</span>
                  <span className="text-ink font-semibold">{h.ef.toFixed(3)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-ink-4">Aerobic decoupling</p>
          <p className={`text-sm font-bold ${data.decoupling >= 5 ? 'text-red-400' : data.decoupling >= 3 ? 'text-yellow-400' : 'text-green-400'}`}>
            {data.decoupling >= 0 ? '+' : ''}{data.decoupling.toFixed(1)}%
            <span className="text-micro font-normal text-ink-4 ml-1.5">
              {data.decoupling < 3 ? 'Excellent' : data.decoupling < 5 ? 'Acceptable' : 'Drift detected'}
            </span>
          </p>
        </div>
      </div>

      {/* Efficiency Graph */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-mini text-ink-4 uppercase tracking-wider">Efficiency Graph</p>
          {/* Toggle buttons */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowPower(p => !p)}
              className={`px-2 py-0.5 rounded text-micro font-medium transition-colors border ${
                showPower
                  ? 'bg-accent/20 text-accent-hi border-accent/50'
                  : 'bg-raised text-ink-5 border-transparent'
              }`}
            >
              W
            </button>
            <button
              onClick={() => setShowHr(h => !h)}
              className={`px-2 py-0.5 rounded text-micro font-medium transition-colors border ${
                showHr
                  ? 'bg-blue-500/20 text-blue-400 border-blue-500/50'
                  : 'bg-raised text-ink-5 border-transparent'
              }`}
            >
              ♥
            </button>
            <button
              onClick={() => setShowEf(e => !e)}
              className={`px-2 py-0.5 rounded text-micro font-medium transition-colors border ${
                showEf
                  ? 'bg-white/10 text-ink border-white/40'
                  : 'bg-raised text-ink-5 border-transparent'
              }`}
            >
              EF
            </button>
          </div>
          {/* Compare period selector — only shown in fitness screen */}
          {showCompare && (
            <div className="flex items-center gap-1.5">
              <span className="text-micro text-ink-5">Compare vs:</span>
              {COMPARE_PERIODS.map(p => (
                <button
                  key={p.key}
                  onClick={() => setComparePeriod(prev => prev === p.key ? null : p.key)}
                  className={`px-2 py-0.5 rounded text-micro font-medium transition-colors border ${
                    comparePeriod === p.key
                      ? 'bg-blue-500/20 text-blue-400 border-blue-500/50'
                      : 'bg-raised text-ink-4 hover:text-ink-2 border-transparent'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {chartData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-ink-4 text-sm">No stream data</div>
        ) : (
          <>
            <EnlargeableChart
              title="Efficiency Graph"
              controls={
                <div className="flex items-center gap-3 flex-wrap justify-end">
                  {/* Toggle buttons */}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setShowPower(p => !p)}
                      className={`px-2 py-0.5 rounded text-micro font-medium transition-colors border ${
                        showPower
                          ? 'bg-accent/20 text-accent-hi border-accent/50'
                          : 'bg-raised text-ink-5 border-transparent'
                      }`}
                    >
                      W
                    </button>
                    <button
                      onClick={() => setShowHr(h => !h)}
                      className={`px-2 py-0.5 rounded text-micro font-medium transition-colors border ${
                        showHr
                          ? 'bg-blue-500/20 text-blue-400 border-blue-500/50'
                          : 'bg-raised text-ink-5 border-transparent'
                      }`}
                    >
                      ♥
                    </button>
                    <button
                      onClick={() => setShowEf(e => !e)}
                      className={`px-2 py-0.5 rounded text-micro font-medium transition-colors border ${
                        showEf
                          ? 'bg-white/10 text-ink border-white/40'
                          : 'bg-raised text-ink-5 border-transparent'
                      }`}
                    >
                      EF
                    </button>
                  </div>
                  {/* Compare period selector — only shown in fitness screen */}
                  {showCompare && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-micro text-ink-5">Compare vs:</span>
                      {COMPARE_PERIODS.map(p => (
                        <button
                          key={p.key}
                          onClick={() => setComparePeriod(prev => prev === p.key ? null : p.key)}
                          className={`px-2 py-0.5 rounded text-micro font-medium transition-colors border ${
                            comparePeriod === p.key
                              ? 'bg-blue-500/20 text-blue-400 border-blue-500/50'
                              : 'bg-raised text-ink-4 hover:text-ink-2 border-transparent'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              }
            >
              {(fs) => (
            <ResponsiveContainer width="100%" height={fs ? '100%' : 220}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={[0, 'dataMax']}
                  tick={{ fill: CHART.axisText, fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => `${v}m`}
                  tickCount={6}
                />
                {/* EF on the LEFT — it is what the chart is for. It used to sit
                    on the far right in white at 0.7 opacity, the least visible
                    series on its own chart. */}
                {showEf && (
                  <YAxis
                    yAxisId="ef"
                    domain={efDomain}
                    tick={{ fill: CHART.axisText, fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={44}
                    tickFormatter={v => v.toFixed(2)}
                    label={{ value: 'W/bpm', angle: -90, position: 'insideLeft',
                             fill: CHART.axisText, fontSize: 10, offset: 8 }}
                  />
                )}
                {/* Power and HR are supporting context, on the right. */}
                {showPower && (
                  <YAxis
                    yAxisId="w"
                    orientation="right"
                    domain={['auto', 'auto']}
                    tick={{ fill: CHART.axisText, fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={36}
                    tickFormatter={v => `${v}W`}
                  />
                )}
                {showHr && (
                  <YAxis
                    yAxisId="hr"
                    orientation="right"
                    domain={['auto', 'auto']}
                    tick={{ fill: CHART.axisText, fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={36}
                    tickFormatter={v => `${v}`}
                  />
                )}
                {/* Always-mounted hidden axis. The half-split used to hang off
                    yAxisId="w", which unmounts with the Power toggle — turning
                    Power off silently removed the shading the caption promised. */}
                <YAxis yAxisId="split" hide domain={[0, 1]} />
                {/* Shade first vs second half */}
                {halfMin > 0 && (
                  <ReferenceArea
                    yAxisId="split"
                    x1={0}
                    x2={halfMin}
                    y1={0}
                    y2={1}
                    fill={CHART.ef}
                    fillOpacity={0.09}
                    stroke="none"
                  />
                )}
                {halfMin > 0 && (
                  <ReferenceLine
                    yAxisId="split"
                    x={halfMin}
                    stroke={CHART.axis}
                    strokeDasharray="4 3"
                    label={{ value: 'Half', fill: CHART.axisText, fontSize: 9, position: 'insideTopRight' }}
                  />
                )}
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: CHART.cursor, strokeWidth: 1 }} />
                {showPower && (
                  <Line
                    yAxisId="w"
                    dataKey="watts"
                    stroke={CHART.power}
                    strokeWidth={1}
                    strokeOpacity={0.45}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                )}
                {showHr && (
                  <Line
                    yAxisId="hr"
                    dataKey="hr"
                    stroke={CHART.hr}
                    strokeWidth={1}
                    strokeOpacity={0.45}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                )}
                {showEf && (
                  <Line
                    yAxisId="ef"
                    dataKey="ef"
                    stroke={CHART.ef}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                )}
                {/* Comparison overlay lines — match active toggles */}
                {compareChartData.length > 0 && (
                  <>
                    {showPower && (
                      <Line
                        yAxisId="w"
                        data={compareChartData}
                        dataKey="watts"
                        stroke={CHART.power}
                        strokeWidth={1}
                        dot={false}
                        isAnimationActive={false}
                        connectNulls
                        strokeDasharray="4 3"
                        opacity={0.5}
                      />
                    )}
                    {showHr && (
                      <Line
                        yAxisId="hr"
                        data={compareChartData}
                        dataKey="hr"
                        stroke={CHART.hr}
                        strokeWidth={1}
                        dot={false}
                        isAnimationActive={false}
                        connectNulls
                        strokeDasharray="4 3"
                        opacity={0.5}
                      />
                    )}
                    {showEf && (
                      <Line
                        yAxisId="ef"
                        data={compareChartData}
                        dataKey="ef"
                        stroke={CHART.reference}
                        strokeWidth={1}
                        dot={false}
                        isAnimationActive={false}
                        connectNulls
                        strokeDasharray="4 3"
                        opacity={0.35}
                      />
                    )}
                  </>
                )}
              </LineChart>
            </ResponsiveContainer>
              )}
            </EnlargeableChart>
            <p className="text-micro text-ink-5 mt-2">
              {showPower && <><span className="text-accent-hi">—</span> Power (W) ·</>}
              {showHr && <><span className="text-blue-400 ml-1.5">—</span> Heart rate (bpm) ·</>}
              {showEf && <><span className="text-ink ml-1.5">—</span> EF ·</>}
              {comparePeriod && compareChartData.length > 0 && (
                <span className="text-ink-4"><span className="opacity-50">- -</span> {COMPARE_LABELS[comparePeriod]} ·</span>
              )}
              <span className="text-ink-5">First half shaded</span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
