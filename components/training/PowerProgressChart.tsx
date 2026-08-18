'use client';

import { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import EnlargeableChart from '@/components/EnlargeableChart';
import { CHART } from '@/lib/chart-theme';

interface Target {
  key:          string;
  label:        string;
  seconds:      number;
  repeats:      number | null;
  target_watts: number;
  color:        string;
  source:       'profile' | 'ftp';
}

interface PowerData {
  weekly:  Record<string, number | string | null>[];
  current: Record<string, number | null>;
  targets: Target[];
  ftp:     number;
}

function fmtWeek(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const rows = (payload as { name: string; value: number; color: string }[]).filter(p => p.value != null);
  return (
    <div className="bg-surface border border-line-strong rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-ink-3 mb-1">{label}</p>
      {rows.map(p => (
        <p key={p.name} style={{ color: p.color }} className="font-semibold">
          {p.name}: {p.value}W
        </p>
      ))}
    </div>
  );
}

const POWER_CACHE_KEY = 'cache-power-progress';

function defaultShown(d: PowerData): Set<string> {
  const keys = d.targets.map(t => t.key);
  const mid = Math.floor(keys.length / 2);
  return new Set(keys.slice(Math.max(0, mid - 1), mid + 1));
}

export default function PowerProgressChart() {
  const [data, setData] = useState<PowerData | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const s = localStorage.getItem(POWER_CACHE_KEY);
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  });
  const [loading, setLoading] = useState(() => {
    if (typeof window === 'undefined') return true;
    try { return !localStorage.getItem(POWER_CACHE_KEY); }
    catch { return true; }
  });
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<Set<string> | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const s = localStorage.getItem(POWER_CACHE_KEY);
      if (s) return defaultShown(JSON.parse(s) as PowerData);
    } catch {}
    return null;
  });

  useEffect(() => {
    fetch('/api/training/power-progress')
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return; }
        setData(d);
        setShown(prev => prev ?? defaultShown(d));
        try { localStorage.setItem(POWER_CACHE_KEY, JSON.stringify(d)); } catch {}
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  function toggleDuration(key: string) {
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
        <div className="grid grid-cols-5 gap-2">
          {[1,2,3,4,5].map(i => <div key={i} className="h-20 bg-raised rounded-xl animate-pulse" />)}
        </div>
        <div className="h-52 bg-raised rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error) return <p className="text-red-400 text-xs px-1">{error}</p>;
  if (!data || !data.targets.length) {
    return (
      <div className="bg-raised/40 border border-line-strong border-dashed rounded-xl p-6 text-center">
        <p className="text-sm text-ink-4">No power stream data yet</p>
        <p className="text-xs text-ink-5 mt-1">Run the backfill workflow to load activity streams</p>
      </div>
    );
  }

  const visibleKeys = shown ?? new Set(data.targets.map(t => t.key));

  // Y axis domain
  const allVals: number[] = [];
  for (const w of data.weekly) {
    for (const t of data.targets) {
      if (visibleKeys.has(t.key)) {
        const v = w[t.key];
        if (typeof v === 'number') allVals.push(v);
      }
    }
  }
  for (const t of data.targets) {
    if (visibleKeys.has(t.key)) {
      allVals.push(t.target_watts);
      const cur = data.current[t.key];
      if (typeof cur === 'number') allVals.push(cur);
    }
  }
  const yMin = allVals.length ? Math.floor((Math.min(...allVals) - 20) / 10) * 10 : 200;
  const yMax = allVals.length ? Math.ceil( (Math.max(...allVals) + 20) / 10) * 10 : 500;

  const chartData = data.weekly.map(w => ({ ...w, week: fmtWeek(String(w.week_start)) }));

  const cols = Math.min(data.targets.length, 5);
  const gridCols = cols === 5 ? 'grid-cols-5' : cols === 4 ? 'grid-cols-4' : cols === 3 ? 'grid-cols-3' : 'grid-cols-2';

  return (
    <div className="space-y-3">

      {/* Progress cards */}
      <div className={`grid ${gridCols} gap-2`}>
        {data.targets.map(t => {
          const current = data.current[t.key];
          const pct     = (typeof current === 'number') ? Math.min((current / t.target_watts) * 100, 120) : null;
          const achieved = pct != null && pct >= 100;
          const isShown  = visibleKeys.has(t.key);

          return (
            <button
              key={t.key}
              onClick={() => toggleDuration(t.key)}
              className={`rounded-xl p-3 text-left transition-colors border ${
                isShown ? 'bg-raised border-line-hover' : 'bg-surface/60 border-line opacity-60'
              }`}
            >
              {/* Duration + repeats label */}
              <div className="flex items-center gap-1.5 mb-2">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: t.color }} />
                <span className="text-micro font-semibold text-ink-3 uppercase tracking-wider leading-tight">
                  {t.repeats ? `${t.repeats}×` : ''}{t.label}
                </span>
              </div>

              {/* Current watts */}
              {typeof current === 'number' ? (
                <p className="text-xl font-bold leading-none" style={{ color: achieved ? '#4ade80' : 'white' }}>
                  {current}<span className="text-xs font-normal text-ink-4 ml-0.5">W</span>
                </p>
              ) : (
                <p className="text-sm text-ink-5">No data</p>
              )}

              {/* Target + progress */}
              <p className="text-micro text-ink-4 mt-1">
                Target: {t.target_watts}W
                {t.source === 'ftp' && <span className="ml-1 text-ink-5">est.</span>}
              </p>
              {typeof current === 'number' && (
                <div className="mt-1.5">
                  <div className="h-1 rounded-full bg-hover overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${Math.min(pct ?? 0, 100)}%`, background: achieved ? '#4ade80' : t.color }}
                    />
                  </div>
                  <p className={`text-micro mt-0.5 font-medium ${achieved ? 'text-green-400' : 'text-ink-4'}`}>
                    {achieved ? `+${current - t.target_watts}W ✓` : `${t.target_watts - current}W to go`}
                  </p>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Line chart */}
      {chartData.length > 0 && (
        <div className="bg-raised/60 rounded-xl p-3">
          <p className="text-micro text-ink-4 uppercase tracking-wider mb-3">Best power by week · last 26 weeks</p>
          <EnlargeableChart title="Best power by week · last 26 weeks" controls={
            <div className="flex items-center gap-1 flex-wrap justify-end">
              {data.targets.map(t => {
                const isShown = visibleKeys.has(t.key);
                return (
                  <button
                    key={t.key}
                    onClick={() => toggleDuration(t.key)}
                    className={`flex items-center gap-1 px-2 py-1 rounded-md text-micro font-medium border transition-colors ${
                      isShown ? 'bg-raised border-line-hover text-ink' : 'bg-surface/60 border-line text-ink-4'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />
                    {t.repeats ? `${t.repeats}×` : ''}{t.label}
                  </button>
                );
              })}
            </div>
          }>
            {(fs) => (
            <ResponsiveContainer width="100%" height={fs ? '100%' : 200}>
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
              <XAxis
                dataKey="week"
                tick={{ fill: CHART.axisText, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[yMin, yMax]}
                tick={{ fill: CHART.axisText, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={32}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: CHART.axis, strokeWidth: 1 }} />

              {data.targets.filter(t => visibleKeys.has(t.key)).map(t => (
                <ReferenceLine
                  key={`target-${t.key}`}
                  y={t.target_watts}
                  stroke={t.color}
                  strokeDasharray="6 3"
                  strokeOpacity={0.5}
                  strokeWidth={1.5}
                />
              ))}

              {data.targets.filter(t => visibleKeys.has(t.key)).map(t => (
                <Line
                  key={t.key}
                  type="monotone"
                  dataKey={t.key}
                  name={t.label}
                  stroke={t.color}
                  strokeWidth={2}
                  dot={{ fill: t.color, r: 3, strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
            )}
          </EnlargeableChart>

          <div className="flex items-center gap-4 flex-wrap mt-2">
            {data.targets.filter(t => visibleKeys.has(t.key)).map(t => (
              <div key={t.key} className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 inline-block rounded" style={{ background: t.color }} />
                <span className="text-micro text-ink-3">{t.repeats ? `${t.repeats}×` : ''}{t.label}</span>
                <span className="text-micro text-ink-5">— — {t.target_watts}W</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
