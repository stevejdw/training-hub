'use client';

import { useEffect, useRef, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, YAxis, ReferenceLine, Tooltip } from 'recharts';
import { useCachedFetch } from '@/lib/use-cached-fetch';

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

type Timeframe = '30d' | '90d' | '6m' | '1y' | 'all';

const TIMEFRAMES: { key: Timeframe; label: string; days: number; weeks: number }[] = [
  { key: '30d', label: '30d', days: 30,    weeks: 5   },
  { key: '90d', label: '90d', days: 90,    weeks: 13  },
  { key: '6m',  label: '6mo', days: 180,   weeks: 26  },
  { key: '1y',  label: '1y',  days: 365,   weeks: 52  },
  { key: 'all', label: 'All', days: 99999, weeks: 999 },
];

/** Default durations: 3, 5, 10, 20, 30, 60 min */
const DEFAULT_DURATIONS = [180, 300, 600, 1200, 1800, 3600];
const STORAGE_KEY = 'key-intervals-config';

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

interface IntervalCardProps {
  target:        Target;
  current:       number | null;
  weekly:        WeeklyRow[];
  isEditing:     boolean;
  draft:         string;
  onStartEdit:   () => void;
  onDraftChange: (s: string) => void;
  onCommit:      () => void;
  onCancel:      () => void;
}

function IntervalCard({
  target, current, weekly,
  isEditing, draft, onStartEdit, onDraftChange, onCommit, onCancel,
}: IntervalCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (isEditing) inputRef.current?.select(); }, [isEditing]);

  const pct  = current ? Math.min(120, (current / target.target_watts) * 100) : 0;
  const gap  = current ? current - target.target_watts : null;
  const buck = progressBucket(current, target.target_watts);

  const series = weekly.map(w => ({ week: w.week_start, watts: (w[target.key] as number | null) ?? null }))
                       .filter(r => r.watts != null);

  return (
    <div className="bg-gray-800/60 border border-gray-800 rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="number"
                step="0.5"
                min="0.1"
                inputMode="decimal"
                value={draft}
                onChange={e => onDraftChange(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') onCommit();
                  if (e.key === 'Escape') onCancel();
                }}
                onBlur={onCommit}
                className="w-20 bg-gray-900 border border-orange-500 rounded px-2 py-1 text-sm text-white focus:outline-none"
              />
              <span className="text-xs text-gray-400">min</span>
              <button
                onMouseDown={e => { e.preventDefault(); onCommit(); }}
                className="text-xs text-orange-400 hover:text-orange-300 font-medium"
              >
                Save
              </button>
              <button
                onMouseDown={e => { e.preventDefault(); onCancel(); }}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={onStartEdit}
              className="text-sm font-semibold text-white hover:text-orange-400 transition-colors text-left flex items-center gap-1.5 group"
              title="Click to change duration"
            >
              {formatRepeats(target)}
              <svg className="w-3.5 h-3.5 text-gray-600 group-hover:text-orange-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          )}
          <div className="text-xs text-gray-500 mt-0.5">
            Target: <span className="text-gray-300 font-medium">{target.target_watts}W</span>
            {target.source === 'ftp' && <span className="ml-1 text-[10px] text-gray-600">(from FTP)</span>}
          </div>
        </div>
        {!isEditing && (
          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider text-white ${buck.color}`}>
            {buck.label}
          </span>
        )}
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
            Best: <span className="text-white font-semibold">{current ? `${current}W` : '—'}</span>
          </span>
          {gap !== null && (
            <span className={gap >= 0 ? 'text-green-400' : 'text-yellow-400'}>
              {gap >= 0 ? '+' : ''}{gap}W
            </span>
          )}
        </div>
      </div>

      {/* Mini sparkline */}
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
  const [timeframe, setTimeframe] = useState<Timeframe>('90d');
  const [durations, setDurations] = useState<number[]>(DEFAULT_DURATIONS);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [hydrated, setHydrated] = useState(false);

  // Load persisted config on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const cfg = JSON.parse(saved);
        if (Array.isArray(cfg.durations)
            && cfg.durations.every((n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0)
            && cfg.durations.length > 0) {
          setDurations(cfg.durations as number[]);
        }
        if (typeof cfg.timeframe === 'string'
            && TIMEFRAMES.some(t => t.key === cfg.timeframe)) {
          setTimeframe(cfg.timeframe);
        }
      }
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);

  // Persist config whenever it changes (after hydration)
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ durations, timeframe }));
    } catch { /* full quota etc */ }
  }, [durations, timeframe, hydrated]);

  const tf = TIMEFRAMES.find(t => t.key === timeframe) ?? TIMEFRAMES[1];
  const qs = `days=${tf.days}&weeks=${tf.weeks}&durations=${durations.join(',')}`;
  const { data, loading } = useCachedFetch<ProgressData>(
    `/api/training/power-progress?${qs}`,
    `cache-training-power-progress-${qs}`,
  );

  function startEdit(idx: number) {
    setEditingIdx(idx);
    setDraft(String(durations[idx] / 60));
  }

  function commitEdit() {
    if (editingIdx === null) return;
    const m = parseFloat(draft);
    if (!isFinite(m) || m <= 0) {
      setEditingIdx(null);
      return;
    }
    const sec = Math.max(1, Math.round(m * 60));
    if (sec === durations[editingIdx]) {
      setEditingIdx(null);
      return;
    }
    const next = durations.slice();
    next[editingIdx] = sec;
    next.sort((a, b) => a - b);
    setDurations(next);
    setEditingIdx(null);
  }

  function cancelEdit() {
    setEditingIdx(null);
  }

  return (
    <div className="space-y-3">
      {/* Timeframe selector */}
      <div className="flex bg-gray-800 rounded-xl p-1 gap-1">
        {TIMEFRAMES.map(t => (
          <button
            key={t.key}
            onClick={() => setTimeframe(t.key)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              timeframe === t.key ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-gray-500">
        Best in the last {tf.label} vs target. Click any interval label (e.g. <span className="text-gray-400">3 min</span>) to change its duration.
      </p>

      {loading && !data ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {durations.map((_, i) => (
            <div key={i} className="bg-gray-800 rounded-2xl h-44 animate-pulse" />
          ))}
        </div>
      ) : !data || !data.targets || data.targets.length === 0 ? (
        <div className="bg-gray-800/40 border border-gray-700 border-dashed rounded-2xl p-8 text-center">
          <h3 className="text-base font-semibold text-white">No power data</h3>
          <p className="text-sm text-gray-400 mt-2">
            Connect Strava and complete some rides to see interval progress.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {data.targets.map((t, i) => (
            <IntervalCard
              key={`${i}-${t.seconds}`}
              target={t}
              current={(data.current[t.key] as number | null) ?? null}
              weekly={data.weekly}
              isEditing={editingIdx === i}
              draft={draft}
              onStartEdit={() => startEdit(i)}
              onDraftChange={setDraft}
              onCommit={commitEdit}
              onCancel={cancelEdit}
            />
          ))}
        </div>
      )}
    </div>
  );
}
