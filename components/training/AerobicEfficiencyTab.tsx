'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  ComposedChart, Scatter, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
  LineChart,
  ReferenceLine,
  ReferenceArea,
} from 'recharts';
import { useCachedFetch } from '@/lib/use-cached-fetch';

import ActivityMap from '@/components/ActivityMap';
import Link from 'next/link';

interface Ride {
  id:          number;
  date:        string;
  name:        string;
  summary_polyline: string | null;
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
  hrv_low:     boolean | null;
}

interface ApiResponse {
  rides:            Ride[];
  zone_boundaries:  number[] | null;  // [z1_max, z2_max, z3_max, z4_max]
}

interface ScatterPoint extends Ride {
  x: number;   // epoch ms
  y: number;   // EF = np / avg_hr
}

interface TrendPoint {
  x: number;
  trendY: number;
}

interface StreamData {
  name:           string;
  date:           string;
  moving_time:    number;
  avg_watts:      number;
  avg_hr:         number;
  np:             number;
  n_samples:      number;
  sec_per_sample: number;
  watts:          (number | null)[];
  hr:             (number | null)[];
}

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

type ZoneFilter = 'all' | 'z2' | 'z3';

function fmtDateShort(epochMs: number) {
  return new Date(epochMs).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
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
      <p className="text-gray-400">{new Date(row.x).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      <p className="text-gray-300 truncate max-w-[200px] font-medium">{row.name}</p>
      <p className="text-orange-400 font-semibold pt-1">EF {ef}</p>
      <p className="text-[10px] text-gray-500">{row.avg_watts}W avg · {row.np}W NP · {row.avg_hr} bpm</p>
      {row.hrv_low === true && <p className="text-[10px] text-yellow-400">⚠ Low HRV day</p>}
      <p className="text-[10px] text-gray-600 mt-0.5">Click for ride detail</p>
    </div>
  );
}

// Custom scatter shape: circle normally, triangle when HRV was low
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function EfDotShape(props: any) {
  const { cx, cy, payload } = props;
  if (payload?.hrv_low) {
    // Downward triangle to indicate suppressed readiness
    const size = 5;
    const pts = `${cx},${cy + size} ${cx - size},${cy - size * 0.6} ${cx + size},${cy - size * 0.6}`;
    return <polygon points={pts} fill="#fbbf24" opacity={0.85} />;
  }
  return <circle cx={cx} cy={cy} r={4} fill="#f97316" opacity={0.8} />;
}

/* ── Single Ride Modal ──────────────────────────────────────────────────── */

function RideModal({ ride, onClose }: { ride: ScatterPoint; onClose: () => void }) {
  const [stream, setStream] = useState<StreamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [excluding, setExcluding] = useState(false);
  const [excluded, setExcluded] = useState(false);

  // Brush selection state
  const [brushStart, setBrushStart] = useState<number | null>(null);
  const [brushEnd, setBrushEnd] = useState<number | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const isBrushingRef = useRef(false);
  const brushStartRef = useRef<number | null>(null);
  const brushEndRef = useRef<number | null>(null);
  const chartDataRef = useRef<{ t: number }[]>([]);

  // Window-level mouse event listeners for brush drag
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isBrushingRef.current) return;
      const el = chartContainerRef.current;
      if (!el) return;
      const svg = el.querySelector('svg');
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const chartLeft = rect.left + 0;
      const chartRight = rect.right - 8;
      const chartWidth = chartRight - chartLeft;
      if (chartWidth <= 0) return;
      const cd = chartDataRef.current;
      if (cd.length === 0) return;
      const maxT = cd[cd.length - 1].t;
      if (maxT <= 0) return;
      const mouseX = e.clientX;
      const pct = Math.max(0, Math.min(1, (mouseX - chartLeft) / chartWidth));
      const t = Math.round(pct * maxT);
      brushEndRef.current = t;
      setBrushEnd(t);
    };
    const handleMouseUp = () => {
      if (!isBrushingRef.current) return;
      isBrushingRef.current = false;
      const s = brushStartRef.current;
      const e = brushEndRef.current;
      if (s != null && e != null) {
        const lo = Math.min(s, e);
        const hi = Math.max(s, e);
        if (hi - lo < 1) {
          brushStartRef.current = null;
          brushEndRef.current = null;
          setBrushStart(null);
          setBrushEnd(null);
        }
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Fetch stream data on mount
  useState(() => {
    fetch(`/api/analytics/aerobic-efficiency/${ride.id}`)
      .then(r => r.json())
      .then((d: StreamData & { error?: string }) => {
        if (d.error) { setErr(d.error); } else { setStream(d); }
      })
      .catch(e => setErr(String(e)))
      .finally(() => setLoading(false));
  });

  const chartData = useMemo(() => {
    if (!stream) return [];
    const n = stream.watts.length;
    const secPerSample = stream.sec_per_sample || 1;
    const result = Array.from({ length: n }, (_, i) => ({
      t:     Math.round((i * secPerSample) / 60),   // minutes
      watts: stream.watts[i] ?? null,
      hr:    stream.hr[i]    ?? null,
      ef:    (stream.watts[i] != null && stream.hr[i] != null && stream.hr[i]! > 0) 
        ? stream.watts[i]! / stream.hr[i]! 
        : null,
    }));
    chartDataRef.current = result;
    return result;
  }, [stream]);

  // Half-way point based on time (max t / 2), not data point count
  // This ensures the half marker is visually at the 50% mark on the chart
  const halfMin = chartData.length > 0
    ? chartData[chartData.length - 1].t / 2
    : 0;

  // Compute averages for the selected brush range
  const brushStats = useMemo(() => {
    if (brushStart == null || brushEnd == null) return null;
    const lo = Math.min(brushStart, brushEnd);
    const hi = Math.max(brushStart, brushEnd);
    const selected = chartData.filter(d => d.t >= lo && d.t <= hi && d.watts != null && d.hr != null && d.hr! > 0);
    if (selected.length === 0) return null;
    const avgW = selected.reduce((s, d) => s + d.watts!, 0) / selected.length;
    const avgH = selected.reduce((s, d) => s + d.hr!, 0) / selected.length;
    const avgE = avgW / avgH;
    const durationMin = hi - lo;
    return {
      fromMin: lo,
      toMin: hi,
      durationMin,
      avgWatts: Math.round(avgW),
      avgHr: Math.round(avgH),
      ef: avgE.toFixed(3),
    };
  }, [brushStart, brushEnd, chartData]);

  const ef = (ride.np / ride.avg_hr).toFixed(3);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 pt-[100px] pb-[80px] md:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[calc(100vh-180px)] md:max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-gray-800">
          <div>
            <p className="text-xs text-gray-500">{new Date(ride.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</p>
            <p className="text-sm font-semibold text-white mt-0.5 leading-tight">{ride.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none ml-4">✕</button>
        </div>

        {/* Route map */}
        {ride.summary_polyline && (
          <div className="border-b border-gray-800">
            <ActivityMap polyline={ride.summary_polyline} className="w-full h-44 rounded-none overflow-hidden bg-gray-800" thumbnail />
          </div>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-5 gap-2 p-4 border-b border-gray-800">
          {[
            { label: 'Duration', value: fmtDuration(ride.moving_time) },
            { label: 'Avg Power', value: `${ride.avg_watts}W` },
            { label: 'NP', value: `${ride.np}W` },
            { label: 'Avg HR', value: `${ride.avg_hr} bpm` },
            { label: 'EF', value: ef },
          ].map(s => (
            <div key={s.label} className="text-center">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">{s.label}</p>
              <p className="text-base font-bold text-white mt-0.5">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Half-split comparison */}
        <div className="p-4 border-b border-gray-800">
          <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-3">Aerobic Decoupling — First vs Second Half</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'First half', watts: ride.pw_h1, hr: ride.hr_h1, ef: ride.ef_h1 },
              { label: 'Second half', watts: ride.pw_h2, hr: ride.hr_h2, ef: ride.ef_h2 },
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
            <p className={`text-sm font-bold ${ride.decoupling >= 5 ? 'text-red-400' : ride.decoupling >= 3 ? 'text-yellow-400' : 'text-green-400'}`}>
              {ride.decoupling >= 0 ? '+' : ''}{ride.decoupling.toFixed(1)}%
              <span className="text-[10px] font-normal text-gray-500 ml-1.5">
                {ride.decoupling < 3 ? 'Excellent' : ride.decoupling < 5 ? 'Acceptable' : 'Drift detected'}
              </span>
            </p>
          </div>
        </div>

        {/* EF time series */}
        <div className="p-4">
          <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-3">Efficiency Factor (EF) Over Ride</p>
          {loading ? (
            <div className="h-48 animate-pulse bg-gray-800 rounded-lg" />
          ) : err ? (
            <div className="h-48 flex items-center justify-center text-red-400 text-sm">{err}</div>
          ) : chartData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-500 text-sm">No stream data</div>
          ) : (
            <div ref={chartContainerRef} className="relative select-none">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart
                data={chartData}
                margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                onMouseDown={(_nextState, event) => {
                  // Recharts onMouseDown receives (nextState, event)
                  // nextState has activeCoordinate, activeLabel, etc.
                  // event is the MouseEvent proxy
                  const el = chartContainerRef.current;
                  if (!el) return;
                  const svg = el.querySelector('svg');
                  if (!svg) return;
                  const rect = svg.getBoundingClientRect();
                  const chartLeft = rect.left + 0;
                  const chartRight = rect.right - 8;
                  const chartWidth = chartRight - chartLeft;
                  if (chartWidth <= 0) return;
                  const maxT = chartData.length > 0 ? chartData[chartData.length - 1].t : 0;
                  if (maxT <= 0) return;
                  const mouseX = event.clientX;
                  const pct = Math.max(0, Math.min(1, (mouseX - chartLeft) / chartWidth));
                  const t = Math.round(pct * maxT);
                  brushStartRef.current = t;
                  brushEndRef.current = t;
                  isBrushingRef.current = true;
                  setBrushStart(t);
                  setBrushEnd(t);
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={[0, 'dataMax']}
                  tick={{ fill: '#6b7280', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => `${v}m`}
                  tickCount={6}
                />
                {/* EF Y-axis */}
                <YAxis
                  yAxisId="ef"
                  domain={['auto', 'auto']}
                  tick={{ fill: '#ffffff', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                  tickFormatter={v => v.toFixed(2)}
                />
                {/* Shade first vs second half */}
                {halfMin > 0 && (
                  <ReferenceArea
                    yAxisId="ef"
                    x1={0}
                    x2={halfMin}
                    fill="#f97316"
                    fillOpacity={0.04}
                    stroke="none"
                  />
                )}
                {halfMin > 0 && (
                  <ReferenceLine
                    yAxisId="ef"
                    x={halfMin}
                    stroke="#374151"
                    strokeDasharray="4 3"
                    label={{ value: 'Half', fill: '#6b7280', fontSize: 9, position: 'insideTopRight' }}
                  />
                )}
                {/* Brush selection highlight */}
                {brushStart != null && brushEnd != null && (
                  <ReferenceArea
                    yAxisId="ef"
                    x1={Math.min(brushStart, brushEnd)}
                    x2={Math.max(brushStart, brushEnd)}
                    fill="#3b82f6"
                    fillOpacity={0.08}
                    stroke="#3b82f6"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                )}
                <Line
                  yAxisId="ef"
                  dataKey="ef"
                  stroke="#ffffff"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
            </div>
          )}
          {/* Brush stats display */}
          {brushStats && (
            <div className="mt-3 bg-blue-500/10 border border-blue-500/30 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] text-blue-400 uppercase tracking-wider font-medium">
                  Selection: {brushStats.fromMin}m – {brushStats.toMin}m ({brushStats.durationMin} min)
                </p>
                <button
                  onClick={() => { setBrushStart(null); setBrushEnd(null); }}
                  className="text-[10px] text-gray-500 hover:text-gray-300"
                >
                  Clear
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center">
                  <p className="text-[10px] text-gray-500 uppercase">Avg Power</p>
                  <p className="text-sm font-bold text-orange-400">{brushStats.avgWatts}W</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-gray-500 uppercase">Avg HR</p>
                  <p className="text-sm font-bold text-blue-400">{brushStats.avgHr} bpm</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-gray-500 uppercase">EF</p>
                  <p className="text-sm font-bold text-white">{brushStats.ef}</p>
                </div>
              </div>
            </div>
          )}
        </div>
        {ride.hrv_low === true && (
          <div className="mx-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2 text-xs text-yellow-400">
            ⚠ HRV was below your normal zone on this day — performance may reflect suppressed readiness.
          </div>
        )}

        {/* Exclude + View full activity */}
        <div className="p-4 border-t border-gray-800 flex items-center justify-between">
          <button
            onClick={async () => {
              if (excluding || excluded) return;
              setExcluding(true);
              try {
                const r = await fetch('/api/profile');
                const profile = await r.json();
                const excludedRides: number[] = profile.excluded_rides ?? [];
                if (!excludedRides.includes(ride.id)) {
                  excludedRides.push(ride.id);
                }
                await fetch('/api/profile', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ ...profile, excluded_rides: excludedRides }),
                });
                setExcluded(true);
              } catch {
                // ignore
              } finally {
                setExcluding(false);
              }
            }}
            disabled={excluding || excluded}
            className={`text-xs font-medium transition-colors ${
              excluded
                ? 'text-green-400'
                : 'text-red-400 hover:text-red-300'
            }`}
          >
            {excluded ? '✓ Excluded from analysis' : excluding ? 'Excluding…' : 'Exclude from analysis'}
          </button>
          <Link
            href={`/activities/${ride.id}`}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-orange-400 hover:text-orange-300 transition-colors"
          >
            View full activity
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

      </div>
    </div>
  );
}

/* ── Main tab ───────────────────────────────────────────────────────────── */

export default function AerobicEfficiencyTab() {
  const [period, setPeriod] = useState<ChartPeriod>('3m');
  const [offset, setOffset] = useState(0);
  const [zoneFilter, setZoneFilter] = useState<ZoneFilter>('all');
  const [selectedRide, setSelectedRide] = useState<ScatterPoint | null>(null);

  // Fetch all data once; window client-side so back/forward nav works instantly
  const { data, loading, error } = useCachedFetch<ApiResponse>(
    '/api/analytics/aerobic-efficiency?range=all',
    'cache-aerobic-all',
  );

  const allRides = data?.rides ?? [];
  const zoneBounds = data?.zone_boundaries ?? null;

  // Window rides to the selected period + offset
  const windowedRides = getWindow(allRides, period, offset);

  // Full scatter set for the current window
  const allScatter: ScatterPoint[] = windowedRides.map(r => ({
    ...r,
    x: new Date(r.date).getTime(),
    y: r.avg_hr > 0 ? Math.round((r.np / r.avg_hr) * 1000) / 1000 : 0,
  })).filter(p => p.y > 0);

  // Zone-filtered scatter
  const scatterData: ScatterPoint[] = useMemo(() => {
    if (zoneFilter === 'all' || !zoneBounds) return allScatter;
    const [z1Max, z2Max, z3Max] = zoneBounds;
    return allScatter.filter(p => {
      if (zoneFilter === 'z2') return p.np > z1Max && p.np <= z2Max;
      if (zoneFilter === 'z3') return p.np > z2Max && p.np <= z3Max;
      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allScatter, zoneFilter, zoneBounds]);

  const reg = linearRegression(scatterData);
  const trendLineData: TrendPoint[] = reg && scatterData.length >= 2 ? [
    { x: scatterData[0].x,                      trendY: reg.slope * scatterData[0].x + reg.intercept },
    { x: scatterData[scatterData.length - 1].x,  trendY: reg.slope * scatterData[scatterData.length - 1].x + reg.intercept },
  ] : [];

  const trendPct = trendLineData.length === 2 && trendLineData[0].trendY > 0
    ? ((trendLineData[1].trendY - trendLineData[0].trendY) / trendLineData[0].trendY) * 100
    : null;

  const avgDecoupling = windowedRides.length
    ? windowedRides.reduce((s, r) => s + r.decoupling, 0) / windowedRides.length
    : 0;

  const rangeLabel = CHART_PERIODS.find(p => p.key === period)?.label ?? period;

  const handleDotClick = useCallback((data: { payload?: ScatterPoint }) => {
    if (data.payload) setSelectedRide(data.payload);
  }, []);

  const zoneLabel = useMemo(() => {
    if (zoneFilter === 'all' || !zoneBounds) return null;
    const [z1Max, z2Max, z3Max] = zoneBounds;
    if (zoneFilter === 'z2') return `Zone 2 · ${z1Max + 1}–${z2Max}W`;
    if (zoneFilter === 'z3') return `Zone 3 · ${z2Max + 1}–${z3Max}W`;
    return null;
  }, [zoneFilter, zoneBounds]);

  const hvLowCount = allScatter.filter(p => p.hrv_low === true).length;

  return (
    <div className="space-y-3">

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gray-800/60 rounded-xl p-3 text-center">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Steady rides</p>
          <p className="text-2xl font-bold text-white">{scatterData.length}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">VI &lt; 1.10 · ≥90 min</p>

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
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Aerobic Efficiency (EF)</p>
          <ChartNav
            period={period} offset={offset}
            hasBack={canGoBack(allRides, period, offset)}
            setPeriod={setPeriod} setOffset={setOffset}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex gap-1.5">
            {([
              { key: 'all', label: 'All zones' },
              { key: 'z2', label: 'Zone 2' },
              { key: 'z3', label: 'Zone 3' },
            ] as { key: ZoneFilter; label: string }[]).map(z => (
              <button
                key={z.key}
                onClick={() => setZoneFilter(z.key)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                  zoneFilter === z.key
                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/50'
                    : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                }`}
              >
                {z.label}
              </button>
            ))}
          </div>
          {trendPct !== null && (
            <p className={`text-[11px] font-medium ${trendPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {trendPct >= 0 ? '↑' : '↓'} {Math.abs(trendPct).toFixed(1)}% over {rangeLabel}
            </p>
          )}
        </div>
        {zoneFilter !== 'all' && zoneLabel && (
          <p className="text-[11px] text-blue-400/70 mb-2">
            Filtering to {zoneLabel} · {scatterData.length} of {allScatter.length} rides shown
            {zoneFilter === 'z2' && ' — steady Zone 2 EF trend reflects pure aerobic base.'}
          </p>
        )}
        <p className="text-[11px] text-gray-600 mb-1">
          Efficiency Factor (NP ÷ avg HR) per steady ride. Higher = better aerobic fitness. Click a dot for ride detail.
        </p>

        {error ? (
          <div className="h-64 flex items-center justify-center text-red-400 text-sm">{error}</div>
        ) : loading && scatterData.length === 0 ? (
          <div className="h-64 animate-pulse bg-gray-800 rounded-lg" />
        ) : scatterData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-gray-500 text-sm text-center px-4">
            No steady rides (VI &lt; 1.10) with power + HR in this range
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
                shape={<EfDotShape />}
                isAnimationActive={false}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onClick={handleDotClick as any}
                style={{ cursor: 'pointer' }}
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
          {hvLowCount > 0 && (
            <span className="ml-1.5"><span className="text-yellow-400">▼</span> Low HRV day ({hvLowCount})</span>
          )}
        </p>
      </div>

      {/* Single Ride Modal */}
      {selectedRide && (
        <RideModal ride={selectedRide} onClose={() => setSelectedRide(null)} />
      )}
    </div>
  );
}
