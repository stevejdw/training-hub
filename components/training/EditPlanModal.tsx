'use client';

import { useState } from 'react';
import { TrainingPlan, TrainingDay } from '@/lib/training-plans';

interface Props {
  plan: TrainingPlan;
  onClose: () => void;
  onUpdated: () => void;
}

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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
  const [trainingDays, setTrainingDays] = useState<number[]>(() => detectTrainingDays(plan.days));
  const [status, setStatus] = useState<'idle' | 'generating' | 'saving' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  function toggleDay(d: number) {
    setTrainingDays(prev =>
      prev.includes(d) ? (prev.length > 1 ? prev.filter(x => x !== d) : prev) : [...prev, d].sort()
    );
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
              goal, trainingDays,
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
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md p-6 space-y-5">
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
            {trainingDays.length} days/week selected. Regenerate to apply changes.
          </p>
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

        <div className="flex gap-2 pt-1">
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
            className="py-2 px-3 rounded-lg bg-gray-700 text-gray-300 hover:text-white text-sm transition-colors disabled:opacity-50"
          >
            Save goal
          </button>
          <button
            onClick={handleRegenerate}
            disabled={busy}
            className="flex-1 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Regenerate'}
          </button>
        </div>
      </div>
    </div>
  );
}
