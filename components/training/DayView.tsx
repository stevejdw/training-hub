'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TrainingDay, TrainingSegment } from '@/lib/training-plans';

interface ActivityDetail {
  id: number;
  name: string;
  date: string;
  tss: number;
  moving_time: number;
  distance: number;
  average_watts: number | null;
  normalized_power: number | null;
  weighted_average_watts: number | null;
  average_heartrate: number | null;
  max_heartrate: number | null;
  intensity_factor: number | null;
}

interface Props {
  day: TrainingDay;
  activities: ActivityDetail[];
  onBack: () => void;
  onDayUpdated: () => void;
}

type Mode = 'view' | 'edit' | 'ai';

// ─── constants ───────────────────────────────────────────────────────────────

const SEG_COLORS: Record<string, string> = {
  warmup:   'border-blue-700/50 bg-blue-900/20',
  main:     'border-orange-700/50 bg-orange-900/20',
  cooldown: 'border-green-700/50 bg-green-900/20',
  interval: 'border-red-700/50 bg-red-900/20',
};
const SEG_LABELS: Record<string, string> = {
  warmup: 'Warm-up', main: 'Main Set', cooldown: 'Cool-down', interval: 'Interval',
};
const TYPE_BADGE: Record<string, string> = {
  rest:       'bg-gray-700 text-gray-400',
  recovery:   'bg-blue-900/60 text-blue-400',
  endurance:  'bg-green-900/60 text-green-400',
  tempo:      'bg-yellow-900/60 text-yellow-400',
  threshold:  'bg-orange-900/60 text-orange-400',
  vo2max:     'bg-red-900/60 text-red-400',
  race:       'bg-purple-900/60 text-purple-400',
};
const DAY_TYPES = ['rest','recovery','endurance','tempo','threshold','vo2max','race'] as const;
const SEG_TYPES = ['warmup','main','interval','cooldown'] as const;

const inputCls = 'w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-colors';
const selectCls = inputCls + ' cursor-pointer';

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmt(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m > 0 ? m + 'm' : ''}`.trim() : `${m}m`;
}

function buildCommentary(activity: ActivityDetail, day: TrainingDay): string {
  const np = activity.normalized_power ?? activity.weighted_average_watts;
  const mainSeg = day.segments.find(s => s.type === 'main');
  const parts: string[] = [];
  if (day.duration_min > 0) {
    const prescribedSecs = day.duration_min * 60;
    const diffMins = Math.round((activity.moving_time - prescribedSecs) / 60);
    const pct = Math.abs(diffMins) / day.duration_min;
    if (pct <= 0.10) parts.push(`Duration was spot on (${fmt(activity.moving_time)}).`);
    else if (diffMins > 0) parts.push(`You rode ${diffMins} min longer than prescribed (${fmt(activity.moving_time)} vs ${fmt(prescribedSecs)}).`);
    else parts.push(`Duration was ${Math.abs(diffMins)} min shorter than prescribed.`);
  }
  if (day.tss_target && activity.tss > 0) {
    const diff = activity.tss - day.tss_target;
    const pct = Math.abs(diff) / day.tss_target;
    if (pct <= 0.10) parts.push(`Load was on target (${activity.tss} TSS vs ${day.tss_target} target).`);
    else if (diff > 0) parts.push(`Load was higher than planned (${activity.tss} TSS vs ${day.tss_target} target).`);
    else parts.push(`Load came in below the plan (${activity.tss} TSS vs ${day.tss_target} target).`);
  }
  if (mainSeg?.target_np_watts && np) {
    const diff = Math.round(np) - mainSeg.target_np_watts;
    const pct = Math.abs(diff) / mainSeg.target_np_watts;
    if (pct <= 0.05) parts.push(`Power was right on target (${Math.round(np)}W NP).`);
    else if (diff > 0) parts.push(`You rode ${diff}W above the power target.`);
    else parts.push(`Power came in ${Math.abs(diff)}W below target.`);
  }
  return parts.length === 0 ? 'Activity logged.' : parts.join(' ');
}

// ─── sub-components ──────────────────────────────────────────────────────────

function SegmentCard({ seg }: { seg: TrainingSegment }) {
  const isMain = seg.type === 'main' || seg.type === 'interval';
  return (
    <div className={`rounded-xl border p-4 space-y-3 ${SEG_COLORS[seg.type] ?? SEG_COLORS.main}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">{SEG_LABELS[seg.type] ?? seg.type}</span>
        <span className="text-xs text-gray-400">{seg.duration_min} min</span>
      </div>
      {isMain && seg.description ? (
        <p className="text-sm font-medium text-white leading-relaxed">{seg.description}</p>
      ) : seg.description ? (
        <p className="text-sm text-gray-400">{seg.description}</p>
      ) : null}
      {(seg.target_np_watts || seg.target_avg_hr || seg.zone) && (
        <div className="flex gap-2 flex-wrap">
          {seg.target_np_watts && (
            <div className="bg-black/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-gray-500 uppercase leading-none mb-0.5">Target</p>
              <p className="text-sm font-bold text-white">{seg.target_np_watts}W</p>
            </div>
          )}
          {seg.target_avg_hr && (
            <div className="bg-black/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-gray-500 uppercase leading-none mb-0.5">HR</p>
              <p className="text-sm font-bold text-white">{seg.target_avg_hr} bpm</p>
            </div>
          )}
          {seg.zone && (
            <div className="bg-black/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-gray-500 uppercase leading-none mb-0.5">Zone</p>
              <p className="text-sm font-bold text-white">{seg.zone}</p>
            </div>
          )}
        </div>
      )}
      {seg.notes && <p className="text-xs text-gray-400 italic border-t border-gray-700/50 pt-2">{seg.notes}</p>}
    </div>
  );
}

function ActivityComparison({ activity, day }: { activity: ActivityDetail; day: TrainingDay }) {
  const np = activity.normalized_power ?? activity.weighted_average_watts;
  const mainSeg = day.segments.find(s => s.type === 'main');
  const commentary = buildCommentary(activity, day);
  let onTarget = false;
  if (day.tss_target && activity.tss > 0) {
    onTarget = Math.abs(activity.tss - day.tss_target) / day.tss_target <= 0.15;
  } else if (day.duration_min > 0 && activity.moving_time > 0) {
    onTarget = Math.abs(activity.moving_time - day.duration_min * 60) / (day.duration_min * 60) <= 0.20;
  } else {
    onTarget = true;
  }
  return (
    <div className={`rounded-xl border p-4 space-y-3 ${onTarget ? 'border-green-700/40 bg-green-900/10' : 'border-yellow-700/40 bg-yellow-900/10'}`}>
      <div className="flex items-center gap-2 min-w-0">
        <svg className={`w-4 h-4 flex-shrink-0 ${onTarget ? 'text-green-400' : 'text-yellow-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        <Link href={`/activities/${activity.id}`} className={`text-sm font-semibold truncate hover:underline ${onTarget ? 'text-green-300' : 'text-yellow-300'}`} onClick={e => e.stopPropagation()}>
          {activity.name}
        </Link>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <div className="bg-black/20 rounded-lg p-2">
          <p className="text-[10px] text-gray-500 uppercase mb-0.5">Duration</p>
          <p className="text-sm font-bold text-white">{fmt(activity.moving_time)}</p>
          {day.duration_min > 0 && <p className="text-[10px] text-gray-500">of {fmt(day.duration_min * 60)}</p>}
        </div>
        {activity.tss > 0 && (
          <div className="bg-black/20 rounded-lg p-2">
            <p className="text-[10px] text-gray-500 uppercase mb-0.5">TSS</p>
            <p className="text-sm font-bold text-white">{activity.tss}</p>
            {day.tss_target && <p className="text-[10px] text-gray-500">of {day.tss_target}</p>}
          </div>
        )}
        {np && (
          <div className="bg-black/20 rounded-lg p-2">
            <p className="text-[10px] text-gray-500 uppercase mb-0.5">NP</p>
            <p className="text-sm font-bold text-white">{Math.round(np)}W</p>
            {mainSeg?.target_np_watts && <p className="text-[10px] text-gray-500">of {mainSeg.target_np_watts}W</p>}
          </div>
        )}
        {activity.average_watts && (
          <div className="bg-black/20 rounded-lg p-2">
            <p className="text-[10px] text-gray-500 uppercase mb-0.5">Avg W</p>
            <p className="text-sm font-bold text-white">{Math.round(activity.average_watts)}W</p>
          </div>
        )}
        {activity.average_heartrate && (
          <div className="bg-black/20 rounded-lg p-2">
            <p className="text-[10px] text-gray-500 uppercase mb-0.5">Avg HR</p>
            <p className="text-sm font-bold text-white">{Math.round(activity.average_heartrate)}</p>
          </div>
        )}
        {activity.intensity_factor && (
          <div className="bg-black/20 rounded-lg p-2">
            <p className="text-[10px] text-gray-500 uppercase mb-0.5">IF</p>
            <p className="text-sm font-bold text-white">{activity.intensity_factor.toFixed(2)}</p>
          </div>
        )}
      </div>
      <div className={`rounded-lg px-3 py-2.5 text-xs leading-relaxed ${onTarget ? 'bg-green-900/20 text-green-200' : 'bg-yellow-900/20 text-yellow-200'}`}>
        {commentary}
      </div>
    </div>
  );
}

// ─── segment editor row ───────────────────────────────────────────────────────

function SegmentEditor({
  seg,
  index,
  onChange,
  onRemove,
}: {
  seg: TrainingSegment;
  index: number;
  onChange: (i: number, updated: TrainingSegment) => void;
  onRemove: (i: number) => void;
}) {
  function set<K extends keyof TrainingSegment>(key: K, val: TrainingSegment[K]) {
    onChange(index, { ...seg, [key]: val });
  }
  return (
    <div className={`rounded-xl border p-4 space-y-3 ${SEG_COLORS[seg.type] ?? SEG_COLORS.main}`}>
      <div className="flex items-center justify-between gap-2">
        <select value={seg.type} onChange={e => set('type', e.target.value as TrainingSegment['type'])} className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-orange-500">
          {SEG_TYPES.map(t => <option key={t} value={t}>{SEG_LABELS[t]}</option>)}
        </select>
        <div className="flex items-center gap-2 flex-1 justify-end">
          <input type="number" value={seg.duration_min} onChange={e => set('duration_min', Number(e.target.value))} className="w-16 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white text-right focus:outline-none focus:border-orange-500" min={1} max={300} />
          <span className="text-xs text-gray-500">min</span>
          <button onClick={() => onRemove(index)} className="text-gray-600 hover:text-red-400 transition-colors ml-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
      <textarea value={seg.description} onChange={e => set('description', e.target.value)} rows={2} placeholder="Description" className="w-full bg-gray-900/60 border border-gray-700/60 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 resize-none focus:outline-none focus:border-orange-500" />
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-gray-500 uppercase">Target W</label>
          <input type="number" value={seg.target_np_watts ?? ''} onChange={e => set('target_np_watts', e.target.value ? Number(e.target.value) : null)} placeholder="—" className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-orange-500" />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 uppercase">Target HR</label>
          <input type="number" value={seg.target_avg_hr ?? ''} onChange={e => set('target_avg_hr', e.target.value ? Number(e.target.value) : null)} placeholder="—" className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-orange-500" />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 uppercase">Zone</label>
          <input type="text" value={seg.zone ?? ''} onChange={e => set('zone', e.target.value || null)} placeholder="—" className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-orange-500" />
        </div>
      </div>
      <textarea value={seg.notes ?? ''} onChange={e => set('notes', e.target.value || null)} rows={1} placeholder="Notes (optional)" className="w-full bg-gray-900/60 border border-gray-700/60 rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-600 resize-none focus:outline-none focus:border-orange-500" />
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function DayView({ day, activities, onBack, onDayUpdated }: Props) {
  const [mode, setMode] = useState<Mode>('view');

  // ── manual edit state ──
  const [editTitle,       setEditTitle]       = useState(day.title);
  const [editType,        setEditType]        = useState<TrainingDay['type']>(day.type);
  const [editDuration,    setEditDuration]    = useState(day.duration_min);
  const [editTss,         setEditTss]         = useState<number | ''>(day.tss_target ?? '');
  const [editDescription, setEditDescription] = useState(day.description);
  const [editSegments,    setEditSegments]    = useState<TrainingSegment[]>(day.segments);
  const [saving,          setSaving]          = useState(false);
  const [saveError,       setSaveError]       = useState<string | null>(null);

  // ── AI edit state ──
  const [aiMessage,   setAiMessage]   = useState('');
  const [aiResponse,  setAiResponse]  = useState('');
  const [aiLoading,   setAiLoading]   = useState(false);
  const [aiUpdated,   setAiUpdated]   = useState(false);

  const dateLabel = new Date(day.date + 'T00:00:00Z').toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });

  function enterEdit() {
    setEditTitle(day.title);
    setEditType(day.type);
    setEditDuration(day.duration_min);
    setEditTss(day.tss_target ?? '');
    setEditDescription(day.description);
    setEditSegments(day.segments.map(s => ({ ...s })));
    setSaveError(null);
    setMode('edit');
  }

  async function saveManual() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/training/days/${day.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:        editTitle,
          type:         editType,
          duration_min: editDuration,
          tss_target:   editTss === '' ? null : Number(editTss),
          description:  editDescription,
          segments:     editSegments,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
      onDayUpdated();
      setMode('view');
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function updateSegment(i: number, updated: TrainingSegment) {
    setEditSegments(prev => prev.map((s, idx) => idx === i ? updated : s));
  }
  function removeSegment(i: number) {
    setEditSegments(prev => prev.filter((_, idx) => idx !== i));
  }
  function addSegment() {
    setEditSegments(prev => [...prev, { type: 'main', duration_min: 30, description: '' }]);
  }

  async function sendAiEdit() {
    if (!aiMessage.trim() || aiLoading) return;
    setAiLoading(true);
    setAiResponse('');
    setAiUpdated(false);
    try {
      const res = await fetch(`/api/training/days/${day.id}/ai-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: aiMessage, day }),
      });
      if (!res.body) throw new Error('No stream');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let full = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += dec.decode(value, { stream: true });
        const visible = full.replace('__UPDATED__', '').trimEnd();
        setAiResponse(visible);
      }
      if (full.includes('__UPDATED__')) {
        setAiUpdated(true);
        onDayUpdated();
      }
    } catch (e) {
      setAiResponse(`Error: ${String(e)}`);
    } finally {
      setAiLoading(false);
    }
  }

  // ── HEADER (shared across modes) ─────────────────────────────────────────

  const header = (
    <div className="flex items-start gap-3">
      <button
        onClick={() => {
          if (mode !== 'view') { setMode('view'); return; }
          onBack();
        }}
        className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors flex-shrink-0 mt-0.5"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className={`text-[10px] rounded px-1.5 py-0.5 capitalize font-medium ${TYPE_BADGE[day.type] ?? TYPE_BADGE.endurance}`}>{day.type}</span>
          {day.tss_target && <span className="text-[10px] text-orange-400 bg-orange-500/10 rounded px-1.5 py-0.5">{day.tss_target} TSS</span>}
          {day.duration_min > 0 && <span className="text-[10px] text-gray-500">{fmt(day.duration_min * 60)}</span>}
        </div>
        <h2 className="text-lg font-bold text-white truncate">{day.title}</h2>
        <p className="text-xs text-gray-400">{dateLabel}</p>
      </div>
    </div>
  );

  // ── VIEW MODE ────────────────────────────────────────────────────────────

  if (mode === 'view') {
    return (
      <div className="space-y-4">
        {header}

        {/* Edit actions — prominent, only for non-rest days */}
        {day.type !== 'rest' && (
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={enterEdit}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 text-white text-sm font-medium transition-colors"
            >
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit session
            </button>
            <button
              onClick={() => { setAiResponse(''); setAiUpdated(false); setAiMessage(''); setMode('ai'); }}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white text-sm font-medium transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              Coach AI
            </button>
          </div>
        )}

        {day.description && (
          <div className="bg-gray-800/60 rounded-xl p-4">
            <p className="text-sm text-gray-300">{day.description}</p>
          </div>
        )}
        {day.segments.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Session Structure</h3>
            {day.segments.map((seg, i) => <SegmentCard key={i} seg={seg} />)}
          </div>
        )}
        {activities.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Logged {activities.length === 1 ? 'Activity' : 'Activities'}
            </h3>
            {activities.map(a => <ActivityComparison key={a.id} activity={a} day={day} />)}
          </div>
        )}
        {activities.length === 0 && (
          <div className="bg-gray-800/40 border border-gray-700 border-dashed rounded-xl p-4 text-center">
            <p className="text-sm text-gray-500">No activity logged for this day yet</p>
          </div>
        )}
      </div>
    );
  }

  // ── MANUAL EDIT MODE ────────────────────────────────────────────────────

  if (mode === 'edit') {
    return (
      <div className="space-y-4">
        {header}

        {/* Basic fields */}
        <div className="bg-gray-800/60 rounded-xl p-4 space-y-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Session Details</h3>

          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1.5">Title</label>
            <input type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)} className={inputCls} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1.5">Type</label>
              <select value={editType} onChange={e => setEditType(e.target.value as TrainingDay['type'])} className={selectCls}>
                {DAY_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1.5">Duration (min)</label>
              <input type="number" value={editDuration} onChange={e => setEditDuration(Number(e.target.value))} className={inputCls} min={0} max={600} />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1.5">TSS Target</label>
            <input type="number" value={editTss} onChange={e => setEditTss(e.target.value === '' ? '' : Number(e.target.value))} placeholder="Leave blank for no target" className={inputCls} min={0} max={500} />
          </div>

          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1.5">Description</label>
            <textarea value={editDescription} onChange={e => setEditDescription(e.target.value)} rows={4} className={inputCls + ' resize-none'} placeholder="Workout description and instructions…" />
          </div>
        </div>

        {/* Segments */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Session Structure</h3>
            <button onClick={addSegment} className="text-xs text-orange-400 hover:text-orange-300 transition-colors">+ Add segment</button>
          </div>
          {editSegments.map((seg, i) => (
            <SegmentEditor key={i} seg={seg} index={i} onChange={updateSegment} onRemove={removeSegment} />
          ))}
          {editSegments.length === 0 && (
            <p className="text-sm text-gray-600 text-center py-4">No segments — add one above for structured intervals</p>
          )}
        </div>

        {saveError && <p className="text-red-400 text-xs">{saveError}</p>}

        <div className="flex gap-3 pb-4">
          <button onClick={() => setMode('view')} className="flex-1 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors">
            Cancel
          </button>
          <button onClick={saveManual} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-medium transition-colors">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    );
  }

  // ── AI EDIT MODE ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {header}

      {/* Current session summary */}
      <div className="bg-gray-800/60 rounded-xl p-4 space-y-1">
        <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Current session</p>
        <p className="text-sm text-gray-300">{day.title} · {day.duration_min} min{day.tss_target ? ` · ${day.tss_target} TSS` : ''}</p>
        {day.description && <p className="text-xs text-gray-500 line-clamp-2">{day.description}</p>}
      </div>

      {/* AI response */}
      {aiResponse && (
        <div className={`rounded-xl p-4 border ${aiUpdated ? 'border-green-700/40 bg-green-900/10' : 'border-gray-700 bg-gray-800/60'}`}>
          {aiUpdated && (
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-xs text-green-400 font-medium">Session updated</span>
            </div>
          )}
          <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{aiResponse}</p>
          {aiLoading && <span className="inline-block w-1.5 h-3.5 bg-orange-400 ml-1 animate-pulse rounded-sm" />}
        </div>
      )}

      {/* Input */}
      {!aiUpdated && (
        <div className="space-y-2">
          <label className="text-xs text-gray-500 uppercase tracking-wider block">Tell Coach AI how to change this session</label>
          <textarea
            value={aiMessage}
            onChange={e => setAiMessage(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendAiEdit(); }}
            rows={3}
            disabled={aiLoading}
            placeholder={'e.g. "Make this easier, I\'m tired" or "Change to a 3×10 min threshold workout" or "Shorten to 1 hour"'}
            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 resize-none focus:outline-none focus:border-orange-500 disabled:opacity-50 transition-colors"
          />
          <div className="flex gap-2">
            <button onClick={() => setMode('view')} className="px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-sm text-gray-400 transition-colors">
              Cancel
            </button>
            <button
              onClick={sendAiEdit}
              disabled={!aiMessage.trim() || aiLoading}
              className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {aiLoading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Thinking…
                </>
              ) : 'Ask Coach AI'}
            </button>
          </div>
          <p className="text-[10px] text-gray-600 text-center">⌘Enter to send</p>
        </div>
      )}

      {aiUpdated && (
        <div className="flex gap-2 pb-4">
          <button onClick={() => { setAiResponse(''); setAiUpdated(false); setAiMessage(''); }} className="flex-1 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors">
            Make another change
          </button>
          <button onClick={() => setMode('view')} className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-400 text-white text-sm font-medium transition-colors">
            Done
          </button>
        </div>
      )}
    </div>
  );
}
