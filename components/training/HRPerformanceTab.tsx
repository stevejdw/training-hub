'use client';

import { useEffect, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

interface ZoneDef { z: number; name: string; color: string; min: number; max: number | null }

interface WeekPoint {
  week_start: string;
  efficiency:  number | null;
  ride_count:  number;
  z1_min?:     number;
  z2_min?:     number;
  z3_min?:     number;
  z4_min?:     number;
  z5_min?:     number;
  total_min?:  number;
}

interface HRData {
  weekly:         WeekPoint[];
  zones:          ZoneDef[] | null;
  max_hr:         number | null;
  has_zone_data:  boolean;
}

function fmtWeek(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ZoneTooltip({ active, payload, label, zones }: any) {
  if (!active || !payload?.length) return null;
  const total = (payload as { value: number }[]).reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-gray-400 mb-1">{label}</p>
      {(payload as { name: string; value: number; fill: string }[])
        .filter(p => p.value > 0)
        .reverse()
        .map(p => {
          const z = (zones as ZoneDef[])?.find(z => `z${z.z}` === p.name);
          const pct = total > 0 ? Math.round((p.value / total) * 100) : 0;
          return (
            <p key={p.name} style={{ color: p.fill }} className="font-medium">
              Z{p.name.slice(1)} {z?.name}: {p.value}m ({pct}%)
            </p>
          );
        })}
      <p className="text-gray-400 border-t border-gray-700 mt-1 pt-1">Total: {total}m</p>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function EffTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-gray-400 mb-1">{label}</p>
      {val != null && <p className="text-orange-400 font-semibold">{Number(val).toFixed(2)} W/bpm</p>}
    </div>
  );
}

const HR_CACHE_KEY = (w: number) => `cache-hr-performance-${w}`;
const INITIAL_HR_WEEKS = 16;

export default function HRPerformanceTab() {
  const [data, setData] = useState<HRData | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const s = localStorage.getItem(HR_CACHE_KEY(INITIAL_HR_WEEKS));
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  });
  const [loading, setLoading] = useState(() => {
    if (typeof window === 'undefined') return true;
    try { return !localStorage.getItem(HR_CACHE_KEY(INITIAL_HR_WEEKS)); }
    catch { return true; }
  });
  const [error, setError] = useState<string | null>(null);
  const [weeks, setWeeks] = useState(INITIAL_HR_WEEKS);

  useEffect(() => {
    const cacheKey = HR_CACHE_KEY(weeks);
    let cachedData: HRData | null = null;
    try {
      const s = localStorage.getItem(cacheKey);
      if (s) cachedData = JSON.parse(s);
    } catch {}
    setData(cachedData);
    setLoading(!cachedData);
    setError(null);

    fetch(`/api/analytics/hr-performance?weeks=${weeks}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else {
          setData(d);
          try { localStorage.setItem(cacheKey, JSON.stringify(d)); } catch {}
        }
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [weeks]);

  if (loading) return (
    <div className="space-y-4">
      <div className="h-8 bg-gray-800 rounded-lg animate-pulse w-48" />
      <div className="h-64 bg-gray-800 rounded-xl animate-pulse" />
      <div className="h-64 bg-gray-800 rounded-xl animate-pulse" />
    </div>
  );
  if (error) return <p className="text-red-400 text-sm">{error}</p>;
  if (!data) return null;

  const chartData = data.weekly.map(w => ({
    ...w,
    week: fmtWeek(w.week_start),
  }));

  // Summary stats from last 4 weeks vs previous 4
  const recent = data.weekly.slice(-4).filter(w => w.efficiency != null);
  const prior  = data.weekly.slice(-8, -4).filter(w => w.efficiency != null);
  const avgRecent = recent.length ? recent.reduce((s, w) => s + (w.efficiency ?? 0), 0) / recent.length : null;
  const avgPrior  = prior.length  ? prior.reduce((s, w) => s + (w.efficiency ?? 0), 0) / prior.length  : null;
  const effTrend  = (avgRecent != null && avgPrior != null) ? avgRecent - avgPrior : null;

  // Last week z2 pct
  const lastZoneWeek = [...data.weekly].reverse().find(w => (w.total_min ?? 0) > 0);
  const z2Pct = lastZoneWeek && (lastZoneWeek.total_min ?? 0) > 0
    ? Math.round(((lastZoneWeek.z2_min ?? 0) / lastZoneWeek.total_min!) * 100)
    : null;

  const RANGE_OPTS = [
    { label: '8W',  weeks: 8  },
    { label: '16W', weeks: 16 },
    { label: '26W', weeks: 26 },
  ];

  return (
    <div className="space-y-5">

      {/* Range selector */}
      <div className="flex gap-1.5">
        {RANGE_OPTS.map(o => (
          <button
            key={o.weeks}
            onClick={() => setWeeks(o.weeks)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              weeks === o.weeks
                ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                : 'bg-gray-800 text-gray-500 hover:text-gray-300'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      {(avgRecent != null || z2Pct != null) && (
        <div className="grid grid-cols-3 gap-3">
          {avgRecent != null && (
            <div className="bg-gray-800/60 rounded-xl p-3 text-center">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Aerobic Efficiency</p>
              <p className="text-2xl font-bold text-orange-400">{avgRecent.toFixed(2)}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">W/bpm (4w avg)</p>
            </div>
          )}
          {effTrend != null && (
            <div className="bg-gray-800/60 rounded-xl p-3 text-center">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Trend</p>
              <p className={`text-2xl font-bold ${effTrend > 0 ? 'text-green-400' : effTrend < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                {effTrend > 0 ? '+' : ''}{effTrend.toFixed(2)}
              </p>
              <p className="text-[10px] text-gray-500 mt-0.5">vs prev 4w</p>
            </div>
          )}
          {z2Pct != null && (
            <div className="bg-gray-800/60 rounded-xl p-3 text-center">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Z2 Time</p>
              <p className="text-2xl font-bold text-blue-400">{z2Pct}%</p>
              <p className="text-[10px] text-gray-500 mt-0.5">last week</p>
            </div>
          )}
        </div>
      )}

      {/* Aerobic Efficiency trend */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Aerobic Efficiency</p>
        <p className="text-[11px] text-gray-600 mb-4">Normalised Power ÷ Avg Heart Rate — higher = more watts per heartbeat</p>
        {chartData.every(w => w.efficiency == null) ? (
          <div className="h-48 flex items-center justify-center text-gray-600 text-sm">
            No rides with both power and HR data
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
              <XAxis
                dataKey="week"
                tick={{ fill: '#6b7280', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: '#6b7280', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={36}
                domain={['auto', 'auto']}
              />
              <Tooltip content={<EffTooltip />} cursor={{ stroke: '#374151', strokeWidth: 1 }} />
              <Line
                type="monotone"
                dataKey="efficiency"
                name="W/bpm"
                stroke="#f97316"
                strokeWidth={2}
                dot={{ fill: '#f97316', r: 3, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* HR Zone Distribution */}
      {data.has_zone_data && data.zones ? (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">HR Zone Distribution</p>
          <p className="text-[11px] text-gray-600 mb-4">Minutes per week in each HR zone — Z2 base builds aerobic fitness</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
              <XAxis
                dataKey="week"
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
                unit="m"
              />
              <Tooltip content={<ZoneTooltip zones={data.zones} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Legend
                formatter={(value) => {
                  const z = data.zones?.find(z => `z${z.z}` === value);
                  return <span style={{ color: '#9ca3af', fontSize: 10 }}>Z{value.slice(1)} {z?.name}</span>;
                }}
              />
              {data.zones.map(z => (
                <Bar
                  key={z.z}
                  dataKey={`z${z.z}_min`}
                  name={`z${z.z}`}
                  stackId="zones"
                  fill={z.color}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>

          {/* Zone legend with boundaries */}
          <div className="grid grid-cols-5 gap-1.5 mt-3">
            {data.zones.map(z => (
              <div key={z.z} className="text-center">
                <div className="w-full h-1.5 rounded-full mb-1" style={{ background: z.color }} />
                <p className="text-[10px] font-semibold text-gray-400">Z{z.z}</p>
                <p className="text-[9px] text-gray-600">{z.name}</p>
                <p className="text-[9px] text-gray-700">
                  {z.min}–{z.max ?? '∞'} bpm
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : !data.max_hr ? (
        <div className="bg-gray-800/40 border border-gray-700 border-dashed rounded-xl p-6 text-center">
          <p className="text-sm text-gray-500">Set your Max HR in Settings → Profile to enable zone distribution</p>
        </div>
      ) : (
        <div className="bg-gray-800/40 border border-gray-700 border-dashed rounded-xl p-6 text-center">
          <p className="text-sm text-gray-500">No HR stream data found for cycling activities</p>
          <p className="text-xs text-gray-600 mt-1">Streams are loaded when you view activity details</p>
        </div>
      )}

    </div>
  );
}
