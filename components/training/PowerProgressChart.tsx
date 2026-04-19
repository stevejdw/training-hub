'use client';

import { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

interface WeekPoint {
  week_start: string;
  d5min:  number | null;
  d10min: number | null;
  d20min: number | null;
  d60min: number | null;
}

interface Target {
  key:          string;
  label:        string;
  seconds:      number;
  target_watts: number;
  source:       'profile' | 'ftp';
}

interface PowerData {
  weekly:  WeekPoint[];
  current: { d5min: number | null; d10min: number | null; d20min: number | null; d60min: number | null };
  targets: Target[];
  ftp:     number;
}

const DURATIONS = [
  { key: 'd5min',  label: '5 min',  color: '#ef4444' },
  { key: 'd10min', label: '10 min', color: '#f97316' },
  { key: 'd20min', label: '20 min', color: '#eab308' },
  { key: 'd60min', label: '60 min', color: '#60a5fa' },
] as const;

type DKey = typeof DURATIONS[number]['key'];

function fmtWeek(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const rows = (payload as { name: string; value: number; color: string }[]).filter(p => p.value != null);
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-gray-400 mb-1">{label}</p>
      {rows.map(p => (
        <p key={p.name} style={{ color: p.color }} className="font-semibold">
          {p.name}: {p.value}W
        </p>
      ))}
    </div>
  );
}

export default function PowerProgressChart() {
  const [data,    setData]    = useState<PowerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [shown,   setShown]   = useState<Set<DKey>>(new Set(['d10min', 'd20min']));

  useEffect(() => {
    fetch('/api/training/power-progress')
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setData(d); })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  function toggleDuration(key: DKey) {
    setShown(prev => {
      const next = new Set(prev);
      if (next.has(key)) { if (next.size > 1) next.delete(key); }
      else next.add(key);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-4 gap-2">
          {[1,2,3,4].map(i => <div key={i} className="h-20 bg-gray-800 rounded-xl animate-pulse" />)}
        </div>
        <div className="h-52 bg-gray-800 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error) {
    return <p className="text-red-400 text-xs px-1">{error}</p>;
  }

  if (!data || (!data.weekly.length && !data.current.d5min)) {
    return (
      <div className="bg-gray-800/40 border border-gray-700 border-dashed rounded-xl p-6 text-center">
        <p className="text-sm text-gray-500">No power stream data yet</p>
        <p className="text-xs text-gray-600 mt-1">Run the backfill workflow to load activity streams</p>
      </div>
    );
  }

  const targetMap = new Map(data.targets.map(t => [t.key, t]));

  // Y axis domain — cover all visible lines + targets with some headroom
  const allVals: number[] = [];
  for (const w of data.weekly) {
    for (const d of DURATIONS) {
      if (shown.has(d.key)) {
        const v = w[d.key as keyof WeekPoint];
        if (typeof v === 'number') allVals.push(v);
      }
    }
  }
  for (const d of DURATIONS) {
    if (shown.has(d.key)) {
      const t = targetMap.get(d.key);
      if (t) allVals.push(t.target_watts);
      const cur = data.current[d.key as keyof typeof data.current];
      if (typeof cur === 'number') allVals.push(cur);
    }
  }
  const yMin = allVals.length ? Math.floor((Math.min(...allVals) - 20) / 10) * 10 : 200;
  const yMax = allVals.length ? Math.ceil( (Math.max(...allVals) + 20) / 10) * 10 : 500;

  // Chart data — ensure week labels are human-readable
  const chartData = data.weekly.map(w => ({
    ...w,
    week: fmtWeek(w.week_start),
  }));

  return (
    <div className="space-y-3">

      {/* Progress cards */}
      <div className="grid grid-cols-4 gap-2">
        {DURATIONS.map(d => {
          const target  = targetMap.get(d.key);
          const current = data.current[d.key as keyof typeof data.current];
          const pct     = (current && target) ? Math.min((current / target.target_watts) * 100, 120) : null;
          const achieved = pct != null && pct >= 100;
          const isShown  = shown.has(d.key);

          return (
            <button
              key={d.key}
              onClick={() => toggleDuration(d.key)}
              className={`rounded-xl p-3 text-left transition-colors border ${
                isShown
                  ? 'bg-gray-800 border-gray-600'
                  : 'bg-gray-900/60 border-gray-800 opacity-60'
              }`}
            >
              {/* Duration label */}
              <div className="flex items-center gap-1.5 mb-2">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: d.color }} />
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{d.label}</span>
              </div>

              {/* Current watts */}
              {current != null ? (
                <p className="text-xl font-bold leading-none" style={{ color: achieved ? '#4ade80' : 'white' }}>
                  {current}<span className="text-xs font-normal text-gray-500 ml-0.5">W</span>
                </p>
              ) : (
                <p className="text-sm text-gray-600">No data</p>
              )}

              {/* Target + gap */}
              {target && (
                <>
                  <p className="text-[10px] text-gray-500 mt-1">
                    Target: {target.target_watts}W
                    {target.source === 'ftp' && <span className="ml-1 text-gray-700">FTP</span>}
                  </p>
                  {current != null && (
                    <div className="mt-1.5">
                      {/* Progress bar */}
                      <div className="h-1 rounded-full bg-gray-700 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(pct ?? 0, 100)}%`,
                            background: achieved ? '#4ade80' : d.color,
                          }}
                        />
                      </div>
                      <p className={`text-[10px] mt-0.5 font-medium ${achieved ? 'text-green-400' : 'text-gray-500'}`}>
                        {achieved
                          ? `+${current - target.target_watts}W ✓`
                          : `${target.target_watts - current}W to go`}
                      </p>
                    </div>
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>

      {/* Line chart */}
      {chartData.length > 0 && (
        <div className="bg-gray-800/60 rounded-xl p-3">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-3">Best power by week · last 26 weeks</p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
              <XAxis
                dataKey="week"
                tick={{ fill: '#6b7280', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[yMin, yMax]}
                tick={{ fill: '#6b7280', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={32}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#374151', strokeWidth: 1 }} />

              {/* Target reference lines */}
              {DURATIONS.filter(d => shown.has(d.key)).map(d => {
                const t = targetMap.get(d.key);
                if (!t) return null;
                return (
                  <ReferenceLine
                    key={`target-${d.key}`}
                    y={t.target_watts}
                    stroke={d.color}
                    strokeDasharray="6 3"
                    strokeOpacity={0.5}
                    strokeWidth={1.5}
                  />
                );
              })}

              {/* Power lines */}
              {DURATIONS.filter(d => shown.has(d.key)).map(d => (
                <Line
                  key={d.key}
                  type="monotone"
                  dataKey={d.key}
                  name={d.label}
                  stroke={d.color}
                  strokeWidth={2}
                  dot={{ fill: d.color, r: 3, strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>

          {/* Legend */}
          <div className="flex items-center gap-4 flex-wrap mt-2">
            {DURATIONS.filter(d => shown.has(d.key)).map(d => {
              const t = targetMap.get(d.key);
              return (
                <div key={d.key} className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 inline-block rounded" style={{ background: d.color }} />
                  <span className="text-[10px] text-gray-400">{d.label}</span>
                  {t && <span className="text-[10px] text-gray-600">— — {t.target_watts}W target</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
