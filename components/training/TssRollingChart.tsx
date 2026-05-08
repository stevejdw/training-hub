'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useCachedFetch } from '@/lib/use-cached-fetch';
import type { TssSummaryResponse, TssWeekPoint, TssDayPoint } from '@/app/api/training/tss-summary/route';
import type { TssPlanConfig, AthleteProfile } from '@/lib/profile';

const RANGE_OPTIONS = [1, 4, 8, 12];

function fmtWeekLabel(weekStart: string): string {
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [y, m, d] = weekStart.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${dt.getUTCDate()} ${M[dt.getUTCMonth()]}`;
}

function defaultConfig(): TssPlanConfig {
  // Default anchor = Monday of current week
  const today = new Date();
  const day = today.getUTCDay();
  const diff = (day + 6) % 7;
  today.setUTCDate(today.getUTCDate() - diff);
  return {
    mode:                'plan',  // honour training plan first; user opts in to formula
    starting_tss:        400,
    weekly_increase_pct: 5,
    block_weeks:         4,
    recovery_pct:        65,
    anchor_date:         today.toISOString().slice(0, 10),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload as ChartPoint;
  // Day view (has date property)
  if (p.date) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-lg space-y-0.5">
        <p className="text-gray-400">{label} {p.date}</p>
        <p className="text-orange-400">{p.actual_tss} TSS <span className="text-gray-500 font-normal">actual</span></p>
        {p.target_tss > 0 && (
          <p className="text-blue-400">{p.target_tss} TSS <span className="text-gray-500 font-normal">target</span></p>
        )}
      </div>
    );
  }
  // Week view
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-lg space-y-0.5">
      <p className="text-gray-400">Week of {label}</p>
      <p className="text-orange-400">{p.actual_tss} TSS <span className="text-gray-500 font-normal">actual</span></p>
      {p.target_tss > 0 && (
        <p className="text-blue-400">
          {p.target_tss} TSS <span className="text-gray-500 font-normal">target</span>
          {p.is_recovery && <span className="ml-1 text-green-400">· recovery</span>}
        </p>
      )}
      {p.target_source === 'plan' && <p className="text-[10px] text-gray-600">from training plan</p>}
      {p.target_source === 'formula' && <p className="text-[10px] text-gray-600">from formula</p>}
      {p.high_duration_recovery_warning && (
        <p className="text-amber-400 font-medium pt-1 border-t border-gray-700 mt-1">
          High Duration Warning: May Delay Recovery.
        </p>
      )}
    </div>
  );
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type ChartPoint = {
  label: string;
  actual_tss: number;
  target_tss: number;
  // day-specific (optional)
  date?: string;
  day_label?: string;
  // week-specific (optional)
  week_start?: string;
  week_end?: string;
  is_recovery?: boolean;
  target_source?: string;
  high_duration_recovery_warning?: boolean;
};

export default function TssRollingChart({ compact }: { compact?: boolean }) {
  const [weeks,        setWeeks]        = useState(4);
  const [offset,       setOffset]       = useState(0);   // weeks to scroll back
  const [editing,      setEditing]      = useState(false);
  const [refreshKey,   setRefreshKey]   = useState(0);

  const isDayView = weeks === 1;

  const { data, loading } = useCachedFetch<TssSummaryResponse>(
    `/api/training/tss-summary?weeks=${weeks}&offset=${offset}&granularity=${isDayView ? 'day' : 'week'}&_=${refreshKey}`,
    `cache-tss-summary-${weeks}-${offset}-${refreshKey}`,
  );

  const points = data?.weeks ?? [];
  const days = data?.days ?? undefined;
  const config = data?.config ?? null;

  const chartData: ChartPoint[] = isDayView && days
    ? days.map(d => ({
        ...d,
        label: d.day_label,
      }))
    : points.map(p => ({
        ...p,
        label: fmtWeekLabel(p.week_start),
      }));

  // Show the last (most recent) week's data in the summary boxes
  const lastWeek = points.length > 0 ? points[points.length - 1] : null;
  // For day view, sum daily actual TSS; for week view, use the week-level actual.
  const totalActual = isDayView
    ? (days ?? []).reduce((s, d) => s + d.actual_tss, 0)
    : lastWeek ? lastWeek.actual_tss : points.reduce((s, p) => s + p.actual_tss, 0);
  // Always use the weekly target from the week-level data so the summary
  // boxes (Actual / Target / On track) are consistent regardless of view.
  const totalTarget = lastWeek ? lastWeek.target_tss : 0;
  const onTrack     = totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : null;



  const modeLabel = config?.mode === 'formula' ? 'Custom formula' :
                    config?.mode === 'plan'    ? 'From training plan' :
                    points.some(p => p.target_source === 'plan') ? 'From training plan' :
                    'No plan configured';

  if (compact) {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-3 space-y-2">
        {/* Weekly summary — current week only */}
        <div className="grid grid-cols-3 gap-1.5">
          <div className="bg-gray-800/60 rounded-lg p-1.5 text-center">
            <p className="text-[8px] text-gray-500 uppercase tracking-wider">Actual</p>
            <p className="text-sm font-bold text-orange-400 tabular-nums">{totalActual}</p>
          </div>
          <div className="bg-gray-800/60 rounded-lg p-1.5 text-center">
            <p className="text-[8px] text-gray-500 uppercase tracking-wider">Target</p>
            <p className="text-sm font-bold text-blue-400 tabular-nums">{totalTarget || '—'}</p>
          </div>
          <div className="bg-gray-800/60 rounded-lg p-1.5 text-center">
            <p className="text-[8px] text-gray-500 uppercase tracking-wider">On track</p>
            <p className={`text-sm font-bold tabular-nums ${
              onTrack == null ? 'text-gray-500' :
              onTrack >= 90 && onTrack <= 110 ? 'text-green-400' :
              onTrack > 110 ? 'text-amber-400' :
              'text-red-400'
            }`}>{onTrack != null ? `${onTrack}%` : '—'}</p>
          </div>
        </div>

        {/* Mini chart — current week only */}
        {loading && points.length === 0 ? (
          <div className="h-24 animate-pulse bg-gray-800 rounded-lg" />
        ) : (
          <ResponsiveContainer width="100%" height={100}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 8 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 8 }} axisLine={false} tickLine={false} width={24} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: '#374151', fillOpacity: 0.2 }} />
              <Bar dataKey="actual_tss" fill="#f97316" name="actual_tss" radius={[2,2,0,0]} />
              <Line dataKey="target_tss" stroke="#60a5fa" name="target_tss" strokeWidth={1.5}
                    dot={{ r: 2, fill: '#60a5fa', strokeWidth: 0 }}
                    isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    );
  }

  // Date range label from chart data
  const firstLabel = points.length > 0 ? fmtWeekLabel(points[0].week_start) : '';
  const lastLabel  = points.length > 0 ? fmtWeekLabel(points[points.length - 1].week_start) : '';
  const rangeLabel = isDayView && days && days.length > 0
    ? `${days[0].date} – ${days[days.length - 1].date}`
    : firstLabel && lastLabel ? `${firstLabel} – ${lastLabel}` : '';

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Rolling TSS</p>
          <p className="text-[10px] text-gray-600 mt-0.5">{modeLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Range selector */}
          <div className="flex gap-1">
            {RANGE_OPTIONS.map(n => (
              <button
                key={n}
                onClick={() => { setWeeks(n); setOffset(0); }}
                className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                  weeks === n
                    ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                    : 'bg-gray-800 text-gray-500 hover:text-gray-300 border border-transparent'
                }`}
              >
                {n}w
              </button>
            ))}
          </div>
          <button
            onClick={() => setEditing(true)}
            className="text-[10px] text-orange-400 hover:text-orange-300 border border-orange-500/30 hover:border-orange-500/60 rounded px-2 py-1 transition-colors"
          >
            Edit
          </button>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gray-800/60 rounded-lg p-2 text-center">
          <p className="text-[9px] text-gray-500 uppercase tracking-wider">Actual</p>
          <p className="text-lg font-bold text-orange-400 tabular-nums">{totalActual}</p>
        </div>
        <div className="bg-gray-800/60 rounded-lg p-2 text-center">
          <p className="text-[9px] text-gray-500 uppercase tracking-wider">Target</p>
          <p className="text-lg font-bold text-blue-400 tabular-nums">{totalTarget || '—'}</p>
        </div>
        <div className="bg-gray-800/60 rounded-lg p-2 text-center">
          <p className="text-[9px] text-gray-500 uppercase tracking-wider">On track</p>
          <p className={`text-lg font-bold tabular-nums ${
            onTrack == null ? 'text-gray-500' :
            onTrack >= 90 && onTrack <= 110 ? 'text-green-400' :
            onTrack > 110 ? 'text-amber-400' :
            'text-red-400'
          }`}>{onTrack != null ? `${onTrack}%` : '—'}</p>
        </div>
      </div>

      {/* Chart */}
      {loading && points.length === 0 ? (
        <div className="h-44 animate-pulse bg-gray-800 rounded-lg" />
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} width={32} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#374151', fillOpacity: 0.2 }} />
            <Legend
              iconSize={8}
              formatter={value => (
                <span style={{ color: '#9ca3af', fontSize: 10 }}>
                  {value === 'actual_tss' ? 'Actual' : 'Target'}
                </span>
              )}
            />
            <Bar  dataKey="actual_tss" fill="#f97316" name="actual_tss" radius={[3,3,0,0]} />
            <Line dataKey="target_tss" stroke="#60a5fa" name="target_tss" strokeWidth={2}
                  dot={{ r: 4, fill: '#60a5fa', strokeWidth: 0 }}
                  activeDot={{ r: 5 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      {/* Week navigation — below the chart, arrows on sides with date range between */}
      <div className="flex items-center justify-center gap-4 select-none">
        <button
          onClick={() => setOffset(o => o + weeks)}
          className="p-1.5 rounded text-gray-500 hover:text-white hover:bg-gray-800 transition-colors"
          aria-label="Previous weeks"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xs text-gray-300 font-medium tabular-nums text-center min-w-[10rem]">{rangeLabel}</span>
        <button
          onClick={() => setOffset(o => Math.max(0, o - weeks))}
          disabled={offset <= 0}
          className={`p-1.5 rounded transition-colors ${
            offset <= 0 ? 'text-gray-700 cursor-not-allowed' : 'text-gray-500 hover:text-white hover:bg-gray-800'
          }`}
          aria-label="Next weeks"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Per-week breakdown row (only for multi-week views) */}
      {!isDayView && (
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${chartData.length}, 1fr)` }}>
          {chartData.map((p, i) => (
            <div key={p.week_start ?? `w${i}`} className="text-center">
              {p.is_recovery && <span className="text-[8px] text-green-400 font-medium uppercase">recovery</span>}
            </div>
          ))}
        </div>
      )}

      {!isDayView && chartData.some(p => p.high_duration_recovery_warning) && (
        <div
          role="status"
          className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200/95 leading-snug"
        >
          High Duration Warning: May Delay Recovery.
        </div>
      )}

      {editing && (
        <TssGoalEditModal
          initial={config ?? defaultConfig()}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); setRefreshKey(k => k + 1); }}
        />
      )}
    </div>
  );
}

// ─── Edit Modal ──────────────────────────────────────────────────────────────

interface ModalProps {
  initial: TssPlanConfig;
  onClose: () => void;
  onSaved: () => void;
}

function TssGoalEditModal({ initial, onClose, onSaved }: ModalProps) {
  const [cfg,      setCfg]      = useState<TssPlanConfig>(initial);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  // Lock body scroll while modal open
  useEffect(() => {
    const orig = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = orig; };
  }, []);

  // Build a preview of next 8 weeks given the formula
  const preview = useMemo(() => {
    if (cfg.mode !== 'formula') return [];
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const day = today.getUTCDay();
    const diff = (day + 6) % 7;
    const thisMon = new Date(today);
    thisMon.setUTCDate(today.getUTCDate() - diff);

    const anchor = new Date(cfg.anchor_date + 'T00:00:00Z');
    const ratio = 1 + cfg.weekly_increase_pct / 100;
    const buildPerBlock = cfg.block_weeks - 1;

    const result: { label: string; tss: number; recovery: boolean }[] = [];
    for (let i = 0; i < 8; i++) {
      const ws = new Date(thisMon);
      ws.setUTCDate(thisMon.getUTCDate() + i * 7);
      const weeksFromAnchor = Math.round((ws.getTime() - anchor.getTime()) / (7 * 86400_000));
      const positionInBlock = ((weeksFromAnchor % cfg.block_weeks) + cfg.block_weeks) % cfg.block_weeks;
      const blockNum        = Math.floor(weeksFromAnchor / cfg.block_weeks);
      const isRec           = positionInBlock === cfg.block_weeks - 1;
      const lastBuildElapsed = blockNum * buildPerBlock + (buildPerBlock - 1);
      const buildElapsed    = blockNum * buildPerBlock + positionInBlock;
      const buildTss        = cfg.starting_tss * Math.pow(ratio, buildElapsed);
      const recTss          = cfg.starting_tss * Math.pow(ratio, lastBuildElapsed) * cfg.recovery_pct / 100;
      const tss = isRec ? Math.round(recTss) : Math.round(buildTss);
      result.push({ label: fmtWeekLabel(ws.toISOString().slice(0, 10)), tss, recovery: isRec });
    }
    return result;
  }, [cfg]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const profileRes = await fetch('/api/profile');
      const profile = await profileRes.json() as AthleteProfile;
      const updated: AthleteProfile = { ...profile, tss_plan: cfg };
      const r = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function setField<K extends keyof TssPlanConfig>(key: K, value: TssPlanConfig[K]) {
    setCfg(prev => ({ ...prev, [key]: value }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
         onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
           onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-3 border-b border-gray-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">TSS Goal Settings</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">Configure weekly targets for the rolling chart</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Mode */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Source</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setField('mode', 'plan')}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  cfg.mode === 'plan'
                    ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                    : 'bg-gray-800 text-gray-500 border border-transparent hover:text-gray-300'
                }`}>
                From training plan
              </button>
              <button onClick={() => setField('mode', 'formula')}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  cfg.mode === 'formula'
                    ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                    : 'bg-gray-800 text-gray-500 border border-transparent hover:text-gray-300'
                }`}>
                Custom formula
              </button>
            </div>
            <p className="text-[10px] text-gray-600 mt-1.5">
              {cfg.mode === 'plan'
                ? 'Targets sum daily tss_target from your active training plan.'
                : 'Targets follow the formula below (recovery week is the last week of each block).'}
            </p>
          </div>

          {cfg.mode === 'formula' && (
            <>
              {/* Goal */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Starting goal (build week 1)
                </label>
                <div className="flex items-center gap-2">
                  <input type="number" min={50} max={2000} step={10}
                    value={cfg.starting_tss}
                    onChange={e => setField('starting_tss', Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500 tabular-nums" />
                  <span className="text-xs text-gray-500">TSS / week</span>
                </div>
              </div>

              {/* Increase */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Weekly increase
                </label>
                <div className="flex items-center gap-2">
                  <input type="number" min={0} max={50} step={0.5}
                    value={cfg.weekly_increase_pct}
                    onChange={e => setField('weekly_increase_pct', Math.max(0, parseFloat(e.target.value) || 0))}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500 tabular-nums" />
                  <span className="text-xs text-gray-500">% per build week (compound)</span>
                </div>
              </div>

              {/* Block size */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Block size
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[3, 4].map(n => (
                    <button key={n} onClick={() => setField('block_weeks', n as 3 | 4)}
                      className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                        cfg.block_weeks === n
                          ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                          : 'bg-gray-800 text-gray-500 border border-transparent hover:text-gray-300'
                      }`}>
                      {n}-week block
                      <span className="block text-[10px] text-gray-600 mt-0.5">{n - 1} build + 1 recovery</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Recovery */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Recovery week
                </label>
                <div className="flex items-center gap-2">
                  <input type="number" min={20} max={100} step={5}
                    value={cfg.recovery_pct}
                    onChange={e => setField('recovery_pct', Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500 tabular-nums" />
                  <span className="text-xs text-gray-500">% of last build week</span>
                </div>
              </div>

              {/* Anchor date */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Cycle anchor (week 1 Monday)
                </label>
                <input type="date" value={cfg.anchor_date}
                  onChange={e => setField('anchor_date', e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500" />
                <p className="text-[10px] text-gray-600 mt-1">
                  Determines which weeks are build vs recovery. Defaults to current week.
                </p>
              </div>

              {/* Preview */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Next 8 weeks preview
                </label>
                <div className="bg-gray-800/40 rounded-lg p-3 grid grid-cols-4 gap-2">
                  {preview.map((p, i) => (
                    <div key={i} className="text-center">
                      <p className="text-[9px] text-gray-600">{p.label}</p>
                      <p className={`text-xs font-bold tabular-nums ${p.recovery ? 'text-green-400' : 'text-blue-400'}`}>
                        {p.tss}
                      </p>
                      {p.recovery && <p className="text-[8px] text-green-500 uppercase">rec</p>}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-800 flex justify-end gap-2">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg bg-gray-800 text-gray-400 hover:text-gray-200 text-sm transition-colors">
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-white text-sm font-medium transition-colors disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
