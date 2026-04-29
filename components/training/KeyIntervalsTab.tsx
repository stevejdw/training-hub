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

const DEFAULT_DURATIONS = [180, 300, 600, 1200, 1800, 3600]; // 3, 5, 10, 20, 30, 60 min
const STORAGE_KEY       = 'key-intervals-config';

interface StoredConfig {
  durations: number[];
  /** Optional per-duration target wattage override. Keyed by seconds. */
  targets?: Record<number, number>;
  timeframe: Timeframe;
}

function progressBucket(currentW: number | null, targetW: number) {
  if (!currentW) return { color: 'bg-gray-700', label: 'No data' };
  const pct = (currentW / targetW) * 100;
  if (pct >= 100) return { color: 'bg-green-500', label: 'On' };
  if (pct >= 95)  return { color: 'bg-orange-500', label: 'Close' };
  return { color: 'bg-yellow-500', label: 'Below' };
}

function formatLabel(t: Target) {
  if (t.repeats && t.repeats > 1) return `${t.repeats} × ${t.label}`;
  return t.label;
}

interface IntervalCardProps {
  target:  Target;
  current: number | null;
  weekly:  WeeklyRow[];
  /** Effective target wattage to display — may be a user override. */
  effectiveTarget: number;
  onClick: () => void;
}

function IntervalCard({ target, current, weekly, effectiveTarget, onClick }: IntervalCardProps) {
  const pct  = current ? Math.min(120, (current / effectiveTarget) * 100) : 0;
  const gap  = current ? current - effectiveTarget : null;
  const buck = progressBucket(current, effectiveTarget);

  const series = weekly.map(w => ({ week: w.week_start, watts: (w[target.key] as number | null) ?? null }))
                       .filter(r => r.watts != null);

  return (
    <button
      onClick={onClick}
      className="bg-gray-800/60 border border-gray-800 rounded-xl p-2.5 md:p-4 space-y-2 text-left hover:border-gray-700 hover:bg-gray-800/80 active:bg-gray-800 transition-colors w-full"
    >
      <div className="flex items-start justify-between gap-1.5">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] md:text-sm font-semibold text-white truncate">{formatLabel(target)}</div>
          <div className="text-[10px] md:text-xs text-gray-500 mt-0.5">
            Target <span className="text-gray-300 font-medium">{effectiveTarget}W</span>
          </div>
        </div>
        <span className={`px-1.5 py-0.5 rounded text-[9px] md:text-[10px] font-semibold uppercase tracking-wider text-white ${buck.color} flex-shrink-0`}>
          {buck.label}
        </span>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="h-1.5 bg-gray-900 rounded-full overflow-hidden">
          <div className={`h-full transition-all ${buck.color}`} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <div className="flex items-center justify-between text-[10px] md:text-[11px]">
          <span className="text-gray-400">
            Best <span className="text-white font-semibold">{current ? `${current}W` : '—'}</span>
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
        <div className="h-8 md:h-12">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series}>
              <YAxis hide domain={['dataMin - 10', 'dataMax + 10']} />
              <ReferenceLine y={effectiveTarget} stroke="#6b7280" strokeDasharray="3 3" />
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
    </button>
  );
}

interface EditModalProps {
  initialDurationSec: number;
  initialTargetW:     number;
  onCancel: () => void;
  onSave: (durationSec: number, targetW: number) => void;
}

function EditModal({ initialDurationSec, initialTargetW, onCancel, onSave }: EditModalProps) {
  const [durationMin, setDurationMin] = useState<string>(String(initialDurationSec / 60));
  const [targetW,     setTargetW]     = useState<string>(String(initialTargetW));
  const minRef = useRef<HTMLInputElement>(null);
  useEffect(() => { minRef.current?.focus(); minRef.current?.select(); }, []);

  function commit() {
    const m = parseFloat(durationMin);
    const w = parseInt(targetW, 10);
    if (!isFinite(m) || m <= 0)        { onCancel(); return; }
    if (!Number.isFinite(w) || w <= 0) { onCancel(); return; }
    const sec = Math.max(1, Math.round(m * 60));
    onSave(sec, w);
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-gray-900 border border-gray-800 rounded-2xl p-5 w-full max-w-sm space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-white">Edit interval</h3>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1.5">Duration</label>
            <div className="flex items-center gap-2">
              <input
                ref={minRef}
                type="number"
                inputMode="decimal"
                step="0.5"
                min="0.1"
                value={durationMin}
                onChange={e => setDurationMin(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onCancel(); }}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              />
              <span className="text-sm text-gray-400">min</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1.5">Target watts</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                min="50"
                max="2000"
                value={targetW}
                onChange={e => setTargetW(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onCancel(); }}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              />
              <span className="text-sm text-gray-400">W</span>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={commit}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-orange-500 hover:bg-orange-400 text-white transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default function KeyIntervalsTab() {
  const [timeframe, setTimeframe]     = useState<Timeframe>('90d');
  const [durations, setDurations]     = useState<number[]>(DEFAULT_DURATIONS);
  const [overrides, setOverrides]     = useState<Record<number, number>>({});
  const [editingIdx, setEditingIdx]   = useState<number | null>(null);
  const [hydrated, setHydrated]       = useState(false);

  // Load saved config on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const cfg: StoredConfig = JSON.parse(raw);
        if (Array.isArray(cfg.durations)
            && cfg.durations.every(n => typeof n === 'number' && Number.isFinite(n) && n > 0)
            && cfg.durations.length > 0) {
          setDurations(cfg.durations);
        }
        if (cfg.targets && typeof cfg.targets === 'object') {
          const cleaned: Record<number, number> = {};
          for (const [k, v] of Object.entries(cfg.targets)) {
            const ks = parseInt(k, 10);
            const vn = Number(v);
            if (Number.isFinite(ks) && ks > 0 && Number.isFinite(vn) && vn > 0) cleaned[ks] = vn;
          }
          setOverrides(cleaned);
        }
        if (typeof cfg.timeframe === 'string' && TIMEFRAMES.some(t => t.key === cfg.timeframe)) {
          setTimeframe(cfg.timeframe);
        }
      }
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);

  // Persist
  useEffect(() => {
    if (!hydrated) return;
    try {
      const cfg: StoredConfig = { durations, targets: overrides, timeframe };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    } catch { /* full quota */ }
  }, [durations, overrides, timeframe, hydrated]);

  const tf = TIMEFRAMES.find(t => t.key === timeframe) ?? TIMEFRAMES[1];
  const qs = `days=${tf.days}&weeks=${tf.weeks}&durations=${durations.join(',')}`;
  const { data, loading } = useCachedFetch<ProgressData>(
    `/api/training/power-progress?${qs}`,
    `cache-training-power-progress-${qs}`,
  );

  function commitEdit(newDurationSec: number, newTargetW: number) {
    if (editingIdx === null) return;
    const oldSec = durations[editingIdx];
    const next = durations.slice();
    next[editingIdx] = newDurationSec;
    next.sort((a, b) => a - b);
    setDurations(next);

    // Update overrides — drop the old key if duration changed, add new
    setOverrides(prev => {
      const out = { ...prev };
      if (oldSec !== newDurationSec) delete out[oldSec];
      out[newDurationSec] = newTargetW;
      return out;
    });

    setEditingIdx(null);
  }

  // Effective target for a card: user override > API value
  function effectiveTargetFor(t: Target): number {
    return overrides[t.seconds] ?? t.target_watts;
  }

  // Find the duration index for the editing card (by seconds)
  const editingTarget =
    editingIdx !== null && data?.targets?.[editingIdx]
      ? data.targets[editingIdx]
      : null;

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
        Best in the last {tf.label} vs target. Tap any card to change its duration or target.
      </p>

      {loading && !data ? (
        <div className="grid grid-cols-2 gap-2 md:gap-3">
          {durations.map((_, i) => (
            <div key={i} className="bg-gray-800 rounded-xl h-32 md:h-44 animate-pulse" />
          ))}
        </div>
      ) : !data || !data.targets || data.targets.length === 0 ? (
        <div className="bg-gray-800/40 border border-gray-700 border-dashed rounded-2xl p-8 text-center">
          <h3 className="text-base font-semibold text-white">No power data</h3>
          <p className="text-sm text-gray-400 mt-2">Connect Strava and complete some rides to see interval progress.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 md:gap-3">
          {data.targets.map((t, i) => (
            <IntervalCard
              key={`${i}-${t.seconds}`}
              target={t}
              current={(data.current[t.key] as number | null) ?? null}
              weekly={data.weekly}
              effectiveTarget={effectiveTargetFor(t)}
              onClick={() => setEditingIdx(i)}
            />
          ))}
        </div>
      )}

      {editingTarget && (
        <EditModal
          initialDurationSec={editingTarget.seconds}
          initialTargetW={effectiveTargetFor(editingTarget)}
          onCancel={() => setEditingIdx(null)}
          onSave={commitEdit}
        />
      )}
    </div>
  );
}
