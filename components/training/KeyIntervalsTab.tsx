'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, YAxis, XAxis,
  ReferenceLine, Tooltip, CartesianGrid,
} from 'recharts';
import { useCachedFetch } from '@/lib/use-cached-fetch';
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
  { key: '30d', label: '30 days',   days: 30,    weeks: 5   },
  { key: '90d', label: '90 days',   days: 90,    weeks: 13  },
  { key: '6m',  label: '6 months',  days: 180,   weeks: 26  },
  { key: '1y',  label: '1 year',    days: 365,   weeks: 52  },
  { key: 'all', label: 'All time',  days: 99999, weeks: 999 },
];

const DEFAULT_DURATIONS = [180, 300, 600, 1200, 1800, 3600];
const STORAGE_KEY       = 'key-intervals-config';

interface StoredConfig {
  durations: number[];
  targets?:  Record<number, number>;
  timeframe: Timeframe;
}

function progressBucket(currentW: number | null, targetW: number) {
  if (!currentW) return { color: 'bg-hover', label: 'No data' };
  const pct = (currentW / targetW) * 100;
  if (pct >= 100) return { color: 'bg-green-500', label: 'On' };
  if (pct >= 95)  return { color: 'bg-accent', label: 'Close' };
  return { color: 'bg-yellow-500', label: 'Below' };
}

function formatLabel(t: Target) {
  if (t.repeats && t.repeats > 1) return `${t.repeats} × ${t.label}`;
  return t.label;
}

/* ─── Expand modal ─────────────────────────────────────────────────── */

interface ExpandModalProps {
  target:          Target;
  current:         number | null;
  weekly:          WeeklyRow[];
  effectiveTarget: number;
  onClose:         () => void;
}

function ExpandModal({ target, current, weekly, effectiveTarget, onClose }: ExpandModalProps) {
  const pct  = current ? Math.min(120, (current / effectiveTarget) * 100) : 0;
  const gap  = current ? current - effectiveTarget : null;
  const buck = progressBucket(current, effectiveTarget);

  const series = weekly
    .map(w => ({ week: w.week_start, watts: (w[target.key] as number | null) ?? null }))
    .filter(r => r.watts != null);

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-line rounded-2xl p-5 w-full max-w-lg space-y-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-lg font-bold text-ink">{formatLabel(target)}</h3>
            <p className="text-xs text-ink-4 mt-0.5">
              Target <span className="text-ink-2 font-medium">{effectiveTarget}W</span>
              {gap !== null && (
                <span className={`ml-2 ${gap >= 0 ? 'text-green-400' : 'text-yellow-400'}`}>
                  {gap >= 0 ? '+' : ''}{gap}W vs target
                </span>
              )}
            </p>
          </div>
          <button onClick={onClose} className="text-ink-4 hover:text-ink p-1 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="h-2 bg-raised rounded-full overflow-hidden">
            <div className={`h-full transition-all ${buck.color}`} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <div className="flex items-center justify-between text-xs text-ink-3">
            <span>Best <span className="text-ink font-semibold">{current ? `${current}W` : '—'}</span></span>
            <span className={`px-1.5 py-0.5 rounded text-micro font-semibold uppercase tracking-wider text-ink ${buck.color}`}>
              {buck.label}
            </span>
          </div>
        </div>

        {/* Large chart */}
        {series.length >= 2 ? (
          <div className="h-52 md:h-64">
            <EnlargeableChart
              title={formatLabel(target)}
              subtitle={`Target ${effectiveTarget}W${gap !== null ? ` · ${gap >= 0 ? '+' : ''}${gap}W vs target` : ''}`}
            >
              {() => (
              <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
                <XAxis
                  dataKey="week"
                  tickFormatter={v => v.slice(5)}
                  tick={{ fill: CHART.reference, fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  domain={['dataMin - 10', 'dataMax + 20']}
                  tick={{ fill: CHART.reference, fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                />
                <ReferenceLine y={effectiveTarget} stroke={CHART.axisText} strokeDasharray="4 4" label={{ value: 'Target', fill: CHART.axisText, fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ background: CHART.tooltipBg, border: '1px solid #374151', borderRadius: 6, fontSize: 12 }}
                  labelFormatter={v => `Week of ${v}`}
                  formatter={(v) => [`${v}W`, 'Best']}
                />
                <Line type="monotone" dataKey="watts" stroke={target.color} strokeWidth={2.5} dot={{ r: 3, fill: target.color }} />
              </LineChart>
            </ResponsiveContainer>
              )}
            </EnlargeableChart>
          </div>
        ) : (
          <p className="text-sm text-ink-4 text-center py-8">Not enough data to chart yet.</p>
        )}
      </div>
    </div>
  );
}

/* ─── Bulk edit modal ───────────────────────────────────────────────── */

interface EditRow { durationMin: string; targetW: string }

interface BulkEditModalProps {
  targets:   Target[];
  overrides: Record<number, number>;
  onCancel:  () => void;
  onSave:    (rows: { seconds: number; targetW: number }[]) => void;
}

function BulkEditModal({ targets, overrides, onCancel, onSave }: BulkEditModalProps) {
  const [rows, setRows] = useState<EditRow[]>(() =>
    targets.map(t => ({
      durationMin: String(t.seconds / 60),
      targetW:     String(overrides[t.seconds] ?? t.target_watts),
    }))
  );

  function setRow(i: number, field: keyof EditRow, value: string) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  }

  function commit() {
    const result: { seconds: number; targetW: number }[] = [];
    for (const row of rows) {
      const m = parseFloat(row.durationMin);
      const w = parseInt(row.targetW, 10);
      if (!isFinite(m) || m <= 0 || !isFinite(w) || w <= 0) { onCancel(); return; }
      result.push({ seconds: Math.max(1, Math.round(m * 60)), targetW: w });
    }
    onSave(result);
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-surface border border-line rounded-2xl p-5 w-full max-w-sm space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-ink">Edit intervals</h3>

        <div className="space-y-3">
          {targets.map((t, i) => (
            <div key={t.key} className="space-y-1.5">
              <p className="text-xs font-medium text-ink-3">{formatLabel(t)}</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    min="0.1"
                    value={rows[i]?.durationMin ?? ''}
                    onChange={e => setRow(i, 'durationMin', e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onCancel(); }}
                    className="w-full bg-raised border border-line-strong rounded-lg px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:border-accent"
                  />
                  <span className="text-xs text-ink-4 flex-shrink-0">min</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    inputMode="numeric"
                    min="50"
                    max="2000"
                    value={rows[i]?.targetW ?? ''}
                    onChange={e => setRow(i, 'targetW', e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onCancel(); }}
                    className="w-full bg-raised border border-line-strong rounded-lg px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:border-accent"
                  />
                  <span className="text-xs text-ink-4 flex-shrink-0">W</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium text-ink-3 hover:text-ink hover:bg-raised transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={commit}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-accent hover:bg-accent-hi text-ink transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Card ──────────────────────────────────────────────────────────── */

interface IntervalCardProps {
  target:          Target;
  current:         number | null;
  weekly:          WeeklyRow[];
  effectiveTarget: number;
  onClick:         () => void;
}

function IntervalCard({ target, current, weekly, effectiveTarget, onClick }: IntervalCardProps) {
  const pct  = current ? Math.min(120, (current / effectiveTarget) * 100) : 0;
  const gap  = current ? current - effectiveTarget : null;
  const buck = progressBucket(current, effectiveTarget);

  const series = weekly
    .map(w => ({ week: w.week_start, watts: (w[target.key] as number | null) ?? null }))
    .filter(r => r.watts != null);

  return (
    /* role="button" rather than a real <button>: this card contains the
       sparkline's own "enlarge" button, and a button inside a button is
       invalid HTML — React flagged it as a hydration error, and the inner
       control's clicks also fired the card's action. */
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
      }}
      className="bg-raised/60 border border-line rounded-xl p-2.5 md:p-4 space-y-2 text-left hover:border-line-strong hover:bg-raised/80 active:bg-raised transition-colors w-full cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <div className="flex items-start justify-between gap-1.5">
        <div className="min-w-0 flex-1">
          <div className="text-sm md:text-sm font-semibold text-ink truncate">{formatLabel(target)}</div>
          <div className="text-micro md:text-xs text-ink-4 mt-0.5">
            Target <span className="text-ink-2 font-medium">{effectiveTarget}W</span>
          </div>
        </div>
        <span className={`px-1.5 py-0.5 rounded text-micro md:text-micro font-semibold uppercase tracking-wider text-ink ${buck.color} flex-shrink-0`}>
          {buck.label}
        </span>
      </div>

      <div className="space-y-1">
        <div className="h-1.5 bg-surface rounded-full overflow-hidden">
          <div className={`h-full transition-all ${buck.color}`} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <div className="flex items-center justify-between text-micro md:text-mini">
          <span className="text-ink-3">
            Best <span className="text-ink font-semibold">{current ? `${current}W` : '—'}</span>
          </span>
          {gap !== null && (
            <span className={gap >= 0 ? 'text-green-400' : 'text-yellow-400'}>
              {gap >= 0 ? '+' : ''}{gap}W
            </span>
          )}
        </div>
      </div>

      {series.length >= 2 && (
        <div className="h-8 md:h-12">
          <EnlargeableChart title={formatLabel(target)} subtitle={`Target ${effectiveTarget}W`}>
            {() => (
            <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series}>
              <YAxis hide domain={['dataMin - 10', 'dataMax + 10']} />
              <ReferenceLine y={effectiveTarget} stroke={CHART.axisText} strokeDasharray="3 3" />
              <Tooltip
                contentStyle={{ background: CHART.tooltipBg, border: '1px solid #374151', borderRadius: 6, fontSize: 11, padding: '4px 8px' }}
                labelStyle={{ display: 'none' }}
                formatter={(v) => [`${v}W`, ''] as [string, string]}
              />
              <Line type="monotone" dataKey="watts" stroke={target.color} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
            )}
          </EnlargeableChart>
        </div>
      )}
    </div>
  );
}

/* ─── Main tab ──────────────────────────────────────────────────────── */

export default function KeyIntervalsTab() {
  const [timeframe,    setTimeframe]    = useState<Timeframe>('90d');
  const [durations,    setDurations]    = useState<number[]>(DEFAULT_DURATIONS);
  const [overrides,    setOverrides]    = useState<Record<number, number>>({});
  const [expandedIdx,  setExpandedIdx]  = useState<number | null>(null);
  const [bulkEditing,  setBulkEditing]  = useState(false);
  const [hydrated,     setHydrated]     = useState(false);

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

  useEffect(() => {
    if (!hydrated) return;
    try {
      const cfg: StoredConfig = { durations, targets: overrides, timeframe };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    } catch { /* full quota */ }
  }, [durations, overrides, timeframe, hydrated]);

  const tf = TIMEFRAMES.find(t => t.key === timeframe) ?? TIMEFRAMES[1];
  const qs = `days=${tf.days}&weeks=${tf.weeks}&durations=${durations.join(',')}`;
  // Cache-bust version — increment to invalidate all old cache entries
  const CACHE_VERSION = 2;
  const { data, loading } = useCachedFetch<ProgressData>(
    `/api/training/power-progress?${qs}`,
    `cache-v${CACHE_VERSION}-training-power-progress-${qs}`,
  );

  function effectiveTargetFor(t: Target): number {
    return overrides[t.seconds] ?? t.target_watts;
  }

  function commitBulkEdit(rows: { seconds: number; targetW: number }[]) {
    const newDurations = rows.map(r => r.seconds).sort((a, b) => a - b);
    setDurations(newDurations);
    const newOverrides: Record<number, number> = {};
    for (const r of rows) newOverrides[r.seconds] = r.targetW;
    setOverrides(newOverrides);
    setBulkEditing(false);
  }

  const expandedTarget = expandedIdx !== null ? data?.targets?.[expandedIdx] ?? null : null;

  return (
    <div className="space-y-3">
      {/* Timeframe selector + Edit button */}
      <div className="flex items-center gap-2">
        <div className="flex flex-1 bg-raised rounded-xl p-1 gap-1">
          {TIMEFRAMES.map(t => (
            <button
              key={t.key}
              onClick={() => setTimeframe(t.key)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                timeframe === t.key ? 'bg-accent text-ink' : 'text-ink-3 hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setBulkEditing(true)}
          className="flex-shrink-0 px-3 py-2 rounded-xl text-xs font-medium bg-raised text-ink-3 hover:text-ink hover:bg-hover transition-colors"
        >
          Edit
        </button>
      </div>

      {loading && !data ? (
        <div className="grid grid-cols-2 gap-2 md:gap-3">
          {durations.map((_, i) => (
            <div key={i} className="bg-raised rounded-xl h-32 md:h-44 animate-pulse" />
          ))}
        </div>
      ) : !data || !data.targets || data.targets.length === 0 ? (
        <div className="bg-raised/40 border border-line-strong border-dashed rounded-2xl p-8 text-center">
          <h3 className="text-base font-semibold text-ink">No power data</h3>
          <p className="text-sm text-ink-3 mt-2">Connect Strava and complete some rides to see interval progress.</p>
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
              onClick={() => setExpandedIdx(i)}
            />
          ))}
        </div>
      )}

      {/* Expanded chart modal */}
      {expandedTarget && data && (
        <ExpandModal
          target={expandedTarget}
          current={(data.current[expandedTarget.key] as number | null) ?? null}
          weekly={data.weekly}
          effectiveTarget={effectiveTargetFor(expandedTarget)}
          onClose={() => setExpandedIdx(null)}
        />
      )}

      {/* Bulk edit modal */}
      {bulkEditing && data?.targets && (
        <BulkEditModal
          targets={data.targets}
          overrides={overrides}
          onCancel={() => setBulkEditing(false)}
          onSave={commitBulkEdit}
        />
      )}
    </div>
  );
}
