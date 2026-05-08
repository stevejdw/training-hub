'use client';

import { useState } from 'react';
import { TrainingPlan, TrainingDay } from '@/lib/training-plans';

interface Props {
  plan: TrainingPlan;
  onClose: () => void;
  onUpdated: () => void;
}

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const TIME_OPTIONS = [
  { label: '1h',   minutes: 60  },
  { label: '1.5h', minutes: 90  },
  { label: '2h',   minutes: 120 },
  { label: '2.5h', minutes: 150 },
  { label: '3h',   minutes: 180 },
  { label: '3.5h', minutes: 210 },
  { label: '4h',   minutes: 240 },
];

interface DaySetting {
  maxMinutes: number;
  isGroupRide: boolean;
}
type DaySettingsMap = Record<number, DaySetting>;

function detectTrainingDays(days: TrainingDay[]): number[] {
  // Look at first week to detect which DOW (0=Mon) have non-rest sessions
  const first7 = days.slice(0, 7);
  const active: number[] = [];
  first7.forEach((day, i) => {
    if (day.type !== 'rest') active.push(i);
  });
  return active.length > 0 ? active : [1, 2, 4, 5, 6]; // default Tue/Wed/Fri/Sat/Sun
}

function startOfWeekSydney(): string {
  const now = new Date(Date.now() + 10 * 60 * 60 * 1000);
  const dow = now.getUTCDay();
  const daysFromMon = dow === 0 ? 6 : dow - 1;
  const mon = new Date(now.getTime() - daysFromMon * 86400000);
  return mon.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function EditPlanModal({ plan, onClose, onUpdated }: Props) {
  const weeks = Math.round(plan.days.length / 7);
  const [goal, setGoal] = useState(plan.goal);
  const [notes, setNotes] = useState('');
  const [trainingDays, setTrainingDays] = useState<number[]>(() => detectTrainingDays(plan.days));
  const [daySettings, setDaySettings] = useState<DaySettingsMap>(() => {
    // Initialise with 2h per day, detect group rides from existing plan descriptions
    const map: DaySettingsMap = {};
    const first7 = plan.days.slice(0, 7);
    DOW_LABELS.forEach((_, i) => {
      const existing = first7[i];
      const isGroup = existing
        ? /group|bunch|club|social/i.test(existing.title + ' ' + (existing.description ?? ''))
        : false;
      map[i] = { maxMinutes: existing?.duration_min ?? 120, isGroupRide: isGroup };
    });
    return map;
  });
  const [status, setStatus] = useState<'idle' | 'generating' | 'saving' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  function toggleDay(d: number) {
    setTrainingDays(prev =>
      prev.includes(d) ? (prev.length > 1 ? prev.filter(x => x !== d) : prev) : [...prev, d].sort()
    );
  }

  function updateDaySetting<K extends keyof DaySetting>(dow: number, key: K, value: DaySetting[K]) {
    setDaySettings(prev => ({ ...prev, [dow]: { ...prev[dow], [key]: value } }));
  }

  async function handleRegenerate() {
    if (status !== 'idle') return;
    setStatus('generating');
    setErrorMsg('');

    try {
      const planStartDate = startOfWeekSydney();
      const planName = plan.name;

      const weekResults = await Promise.all(
        Array.from({ length: weeks }, async (_, i) => {
          const r = await fetch('/api/training/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              goal, notes, trainingDays, daySettings,
              weekIndex: i, planStartDate, totalWeeks: weeks,
              planName, planGoal: goal,
            }),
          });
          const text = await r.text();
          let data: Record<string, unknown>;
          try { data = JSON.parse(text); } catch {
            throw new Error(`Week ${i + 1} failed (HTTP ${r.status}): ${text.slice(0, 150)}`);
          }
          if (data.error) throw new Error(`Week ${i + 1}: ${data.error}`);
          return data;
        })
      );

      const allDays = weekResults.flatMap(r => (r.days as TrainingDay[]) ?? []);

      setStatus('saving');
      const saveRes = await fetch(`/api/training/plans/${plan.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal, days: allDays }),
      });
      const saved = await saveRes.json();
      if (!saveRes.ok || saved.error) throw new Error(saved.error ?? 'Save failed');

      onUpdated();
    } catch (err) {
      setErrorMsg(String(err));
      setStatus('error');
    }
  }

  async function handleSaveGoalOnly() {
    if (status !== 'idle') return;
    setStatus('saving');
    setErrorMsg('');
    try {
      const saveRes = await fetch(`/api/training/plans/${plan.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal, days: plan.days }),
      });
      const saved = await saveRes.json();
      if (!saveRes.ok || saved.error) throw new Error(saved.error ?? 'Save failed');
      onUpdated();
    } catch (err) {
      setErrorMsg(String(err));
      setStatus('error');
    }
  }

  const busy = status === 'generating' || status === 'saving';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col">
      <div className="p-6 overflow-y-auto flex-1 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Edit Plan</h2>
          <button onClick={onClose} disabled={busy} className="text-gray-500 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Goal */}
        <div>
          <label className="text-xs text-gray-400 uppercase tracking-wider block mb-1.5">Goal</label>
          <input
            value={goal}
            onChange={e => setGoal(e.target.value)}
            disabled={busy}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
          />
        </div>

        {/* Additional notes */}
        <div>
          <label className="text-xs text-gray-400 uppercase tracking-wider block mb-1.5">Additional notes (optional)</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            disabled={busy}
            rows={3}
            placeholder="e.g. Focus on threshold work, available Tue/Thu/Sat/Sun, avoid back-to-back hard days"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 resize-none"
          />
        </div>

        {/* Training days */}
        <div>
          <label className="text-xs text-gray-400 uppercase tracking-wider block mb-2">Training days</label>
          <div className="flex gap-1.5">
            {DOW_LABELS.map((label, i) => (
              <button
                key={i}
                onClick={() => toggleDay(i)}
                disabled={busy}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                  trainingDays.includes(i)
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-500 mt-1.5">
            {trainingDays.length} days/week selected.
          </p>
        </div>

        {/* Per-day settings */}
        <div>
          <label className="text-xs text-gray-400 uppercase tracking-wider block mb-2">Day settings</label>
          <div className="space-y-1.5">
            {/* Header row */}
            <div className="grid grid-cols-[56px_1fr_auto] gap-2 px-1">
              <span className="text-[10px] text-gray-600 uppercase tracking-wider">Day</span>
              <span className="text-[10px] text-gray-600 uppercase tracking-wider">Available time</span>
              <span className="text-[10px] text-gray-600 uppercase tracking-wider">Group ride</span>
            </div>
            {trainingDays.map(i => (
              <div key={i} className="grid grid-cols-[56px_1fr_auto] gap-2 items-center bg-gray-800/50 rounded-lg px-2 py-1.5">
                <span className="text-xs font-medium text-gray-300">{DOW_LABELS[i]}</span>
                {/* Time pills */}
                <div className="flex gap-1 flex-wrap">
                  {TIME_OPTIONS.map(opt => (
                    <button
                      key={opt.minutes}
                      onClick={() => updateDaySetting(i, 'maxMinutes', opt.minutes)}
                      disabled={busy}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                        daySettings[i]?.maxMinutes === opt.minutes
                          ? 'bg-orange-500 text-white'
                          : 'bg-gray-700 text-gray-400 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {/* Group ride toggle */}
                <button
                  onClick={() => updateDaySetting(i, 'isGroupRide', !daySettings[i]?.isGroupRide)}
                  disabled={busy}
                  className={`relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ${
                    daySettings[i]?.isGroupRide ? 'bg-blue-500' : 'bg-gray-700'
                  }`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
                    daySettings[i]?.isGroupRide ? 'translate-x-4' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-600 mt-1.5">Group ride days use steady-state targets, not structured intervals.</p>
        </div>

        {status === 'generating' && (
          <div className="flex items-center gap-2 text-sm text-orange-400">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Generating {weeks} weeks…
          </div>
        )}
        {status === 'saving' && <p className="text-sm text-gray-400">Saving…</p>}
        {status === 'error'   && <p className="text-sm text-red-400">{errorMsg}</p>}

        </div>
        {/* Sticky footer */}
        <div className="flex gap-2 p-4 border-t border-gray-800 flex-shrink-0">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-sm transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveGoalOnly}
            disabled={busy}
            className="flex-1 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
