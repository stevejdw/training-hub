'use client';

import { useState } from 'react';
import { TrainingDay } from '@/lib/training-plans';

interface Props {
  onClose: () => void;
  onCreated: (planId: number) => void;
}

export default function CreatePlanModal({ onClose, onCreated }: Props) {
  const [goal, setGoal] = useState('');
  const [notes, setNotes] = useState('');
  const [weeks, setWeeks] = useState(4);
  const [status, setStatus] = useState<'idle' | 'generating' | 'saving' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleGenerate() {
    if (status !== 'idle') return;
    setStatus('generating');
    setErrorMsg('');

    try {
      // Compute plan start date (this Monday in Sydney time, UTC+10)
      const now = new Date(Date.now() + 10 * 60 * 60 * 1000);
      const dow = now.getUTCDay();
      const daysFromMon = dow === 0 ? 6 : dow - 1;
      const mon = new Date(now.getTime() - daysFromMon * 86400000);
      const planStartDate = mon.toISOString().slice(0, 10);

      const planName = `${weeks}-Week Plan${goal ? ': ' + goal.slice(0, 40) : ''}`;
      const planGoal = goal || 'Base fitness';

      // Generate all weeks in parallel — each call handles 1 week (~2s per call)
      const weekResults = await Promise.all(
        Array.from({ length: weeks }, (_, i) =>
          fetch('/api/training/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ goal, notes, weekIndex: i, planStartDate, totalWeeks: weeks, planName, planGoal }),
          }).then(r => r.json())
        )
      );

      // Check for errors
      for (const result of weekResults) {
        if (result.error) throw new Error(result.error);
      }

      // Combine all days in order
      const allDays = weekResults.flatMap((r: { days: TrainingDay[] }) => r.days ?? []);

      setStatus('saving');
      const saveRes = await fetch('/api/training/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: planName, goal: planGoal, days: allDays }),
      });
      const saved = await saveRes.json();
      if (!saveRes.ok || saved.error) {
        throw new Error(saved.error ?? 'Save failed');
      }

      onCreated(saved.id);
    } catch (err) {
      setErrorMsg(String(err));
      setStatus('error');
    }
  }

  const busy = status === 'generating' || status === 'saving';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Generate Training Plan</h2>
          <button onClick={onClose} disabled={busy} className="text-gray-500 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider block mb-1">Goal (optional)</label>
            <input
              value={goal}
              onChange={e => setGoal(e.target.value)}
              disabled={busy}
              placeholder="e.g. Build base for Peaks Challenge"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider block mb-1">Weeks</label>
            <div className="flex gap-2">
              {[4, 8, 12].map(w => (
                <button
                  key={w}
                  onClick={() => setWeeks(w)}
                  disabled={busy}
                  className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    weeks === w ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider block mb-1">Additional notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              disabled={busy}
              rows={2}
              placeholder="e.g. Focus on threshold work, available Tue/Thu/Sat/Sun"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 resize-none"
            />
          </div>
        </div>

        {status === 'generating' && (
          <div className="flex items-center gap-2 text-sm text-orange-400">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Claude is generating your plan…
          </div>
        )}
        {status === 'saving' && (
          <p className="text-sm text-gray-400">Saving plan…</p>
        )}
        {status === 'error' && (
          <p className="text-sm text-red-400">{errorMsg}</p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-sm transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={busy}
            className="flex-1 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Generate with AI'}
          </button>
        </div>
      </div>
    </div>
  );
}
