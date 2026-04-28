'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ResponsiveContainer, LineChart, Line, YAxis, ReferenceLine, Tooltip } from 'recharts';

interface Target {
  key:          string;
  label:        string;
  seconds:      number;
  repeats:      number | null;
  target_watts: number;
  color:        string;
  source:       'profile' | 'ftp';
}

interface WeeklyRow {
  week_start: string;
  [k: string]: number | string;
}

interface ProgressData {
  weekly:  WeeklyRow[];
  current: Record<string, number | null>;
  targets: Target[];
  ftp:     number;
}

function formatRepeats(t: Target) {
  if (t.repeats && t.repeats > 1) return `${t.repeats} × ${t.label}`;
  return t.label;
}

function progressBucket(currentW: number | null, targetW: number) {
  if (!currentW) return { color: 'bg-gray-700', label: 'No data' };
  const pct = (currentW / targetW) * 100;
  if (pct >= 100) return { color: 'bg-green-500', label: 'On target' };
  if (pct >= 95)  return { color: 'bg-orange-500', label: 'Close' };
  return { color: 'bg-yellow-500', label: 'Below' };
}

function IntervalCard({ target, current, weekly }: { target: Target; current: number | null; weekly: WeeklyRow[] }) {
  const pct  = current ? Math.min(120, (current / target.target_watts) * 100) : 0;
  const gap  = current ? current - target.target_watts : null;
  const buck = progressBucket(current, target.target_watts);

  // Filter weekly rows to just this target's column
  const series = weekly.map(w => ({ week: w.week_start, watts: (w[target.key] as number | null) ?? null }))
                       .filter(r => r.watts != null);

  return (
    <div className="bg-gray-800/60 border border-gray-800 rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">{formatRepeats(target)}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            Target: <span className="text-gray-300 font-medium">{target.target_watts}W</span>
            {target.source === 'ftp' && <span className="ml-1 text-[10px] text-gray-600">(from FTP)</span>}
          </div>
        </div>
        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider text-white ${buck.color}`}>
          {buck.label}
        </span>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="h-2 bg-gray-900 rounded-full overflow-hidden relative">
          <div
            className={`h-full transition-all ${buck.color}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-gray-400">
            Best (90d): <span className="text-white font-semibold">{current ? `${current}W` : '—'}</span>
          </span>
          {gap !== null && (
            <span className={gap >= 0 ? 'text-green-400' : 'text-yellow-400'}>
              {gap >= 0 ? '+' : ''}{gap}W
            </span>
          )}
        </div>
      </div>

      {/* Mini sparkline of last 26w */}
      {series.length >= 2 && (
        <div className="h-12">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series}>
              <YAxis hide domain={['dataMin - 10', 'dataMax + 10']} />
              <ReferenceLine y={target.target_watts} stroke="#6b7280" strokeDasharray="3 3" />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #374151', borderRadius: 6, fontSize: 11, padding: '4px 8px' }}
                labelStyle={{ display: 'none' }}
                formatter={(v) => [`${v}W`, ''] as [string, string]}
              />
              <Line type="monotone" dataKey="watts" stroke={target.color} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default function KeyIntervalsTab() {
  const [data, setData]       = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/training/power-progress')
      .then(r => r.json())
      .then((d: ProgressData) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="bg-gray-800 rounded-2xl h-44 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!data || data.targets.length === 0) {
    return (
      <div className="bg-gray-800/40 border border-gray-700 border-dashed rounded-2xl p-8 text-center space-y-3">
        <h3 className="text-base font-semibold text-white">No key intervals yet</h3>
        <p className="text-sm text-gray-400">Add power targets in your profile to track progress on specific intervals.</p>
        <Link
          href="/dashboard?tab=settings&settingsTab=profile"
          className="inline-block mt-1 px-4 py-2 bg-orange-500 hover:bg-orange-400 text-white rounded-xl text-sm font-medium transition-colors"
        >
          Edit profile
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          Best in the last 90 days vs your target. Trend line shows weekly best over the last 26 weeks.
        </p>
        <Link
          href="/dashboard?tab=settings&settingsTab=profile"
          className="text-xs text-orange-400 hover:text-orange-300 transition-colors flex-shrink-0 ml-3"
        >
          Edit targets →
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {data.targets.map(t => (
          <IntervalCard
            key={t.key}
            target={t}
            current={(data.current[t.key] as number | null) ?? null}
            weekly={data.weekly}
          />
        ))}
      </div>
    </div>
  );
}
