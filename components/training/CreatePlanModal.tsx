'use client';

import { useEffect, useState } from 'react';
import { TrainingDay } from '@/lib/training-plans';
import type { BaselineTssResponse } from '@/app/api/training/baseline-tss/route';

interface Props {
  onClose: () => void;
  onCreated: (planId: number) => void;
}

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function CreatePlanModal({ onClose, onCreated }: Props) {
  const [planName, setPlanName] = useState('');
  const [goal, setGoal] = useState('');
  const [notes, setNotes] = useState('');
  const [weeks, setWeeks] = useState(4);
  const [trainingDays, setTrainingDays] = useState<number[]>([1, 2, 4, 5, 6]); // Tue/Wed/Fri/Sat/Sun
  const [weeklyTssTarget, setWeeklyTssTarget] = useState<number | ''>('');
  const [tssSource, setTssSource] = useState<BaselineTssResponse['source'] | null>(null);
  const [tssDetail, setTssDetail] = useState<string>('');
  const [status, setStatus] = useState<'idle' | 'generating' | 'saving' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [weekProgress, setWeekProgress] = useState(0);

  // Fetch the suggested weekly TSS baseline once on mount.
  useEffect(() => {
    fetch('/api/training/baseline-tss')
      .then(r => r.json() as Promise<BaselineTssResponse>)
      .then(data => {
        if (typeof data.suggested === 'number') {
          setWeeklyTssTarget(data.suggested);
          setTssSource(data.source);
          setTssDetail(data.detail);
        }
      })
      .catch(console.error);
  }, []);

  function toggleDay(d: number) {
    setTrainingDays(prev =>
      prev.includes(d) ? (prev.length > 1 ? prev.filter(x => x !== d) : prev) : [...prev, d].sort()
    );
  }

  async function handleGenerate() {
    if (status !== 'idle') return;
    setStatus('generating');
    setErrorMsg('');
    setWeekProgress(0);

    try {
      // Compute plan start date (this Monday in Sydney time, UTC+10)
      const now = new Date(Date.now() + 10 * 60 * 60 * 1000);
      const dow = now.getUTCDay();
      const daysFromMon = dow === 0 ? 6 : dow - 1;
      const mon = new Date(now.getTime() - daysFromMon * 86400000);
      const planStartDate = mon.toISOString().slice(0, 10);

      const resolvedName = planName || `${weeks}-Week Plan${goal ? ': ' + goal.slice(0, 40) : ''}`;
      const planGoal = goal || 'Base fitness';

      // Generate weeks SEQUENTIALLY. Each call takes ~25s; iOS Safari aborts
      // long-running parallel fetches with "TypeError: Load failed", so we
      // can't use Promise.all here. Sequential keeps each connection short.
      // One retry per week for transient network drops.
      const allDays: TrainingDay[] = [];
      for (let i = 0; i < weeks; i++) {
        let lastErr: Error | null = null;
        let weekDays: TrainingDay[] | null = null;
        for (let attempt = 0; attempt < 2 && weekDays === null; attempt++) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 55000);
          try {
            const r = await fetch('/api/training/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                goal, notes, trainingDays, weekIndex: i, planStartDate, totalWeeks: weeks, planName, planGoal,
                weeklyTssTarget: typeof weeklyTssTarget === 'number' && weeklyTssTarget > 0 ? weeklyTssTarget : null,
              }),
              signal: controller.signal,
            });
            const text = await r.text();
            let data: Record<string, unknown>;
            try {
              data = JSON.parse(text);
            } catch {
              throw new Error(`Week ${i + 1} failed (HTTP ${r.status}): ${text.slice(0, 200)}`);
            }
            if (data.error) throw new Error(`Week ${i + 1}: ${data.error}`);
            weekDays = (data.days as TrainingDay[]) ?? [];
          } catch (err) {
            lastErr = err instanceof Error ? err : new Error(String(err));
            // Retry once on network errors (Load failed / aborted)
          } finally {
            clearTimeout(timeout);
          }
        }
        if (weekDays === null) throw lastErr ?? new Error(`Week ${i + 1} failed after retry`);
        allDays.push(...weekDays);
        setWeekProgress(i + 1);
      }

      setStatus('saving');
      const saveRes = await fetch('/api/training/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: resolvedName, goal: planGoal, days: allDays }),
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
            <label className="text-xs text-gray-400 uppercase tracking-wider block mb-1">Name</label>
            <input
              value={planName}
              onChange={e => setPlanName(e.target.value)}
              disabled={busy}
              placeholder="e.g. Summer Base 2026"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500"
            />
          </div>
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
            <label className="text-xs text-gray-400 uppercase tracking-wider block mb-1">
              Weekly TSS target
              {tssSource && (
                <span className="ml-2 normal-case tracking-normal text-[10px] text-gray-500">
                  · {tssSource === 'configured' ? 'from your settings' : tssSource === '4-week-avg' ? 'suggested from last 4 weeks' : 'default'}
                </span>
              )}
            </label>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={10}
              value={weeklyTssTarget}
              onChange={e => {
                const v = e.target.value;
                setWeeklyTssTarget(v === '' ? '' : Math.max(0, Number(v)));
              }}
              disabled={busy}
              placeholder="e.g. 400"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500"
            />
            {tssDetail && (
              <p className="text-[10px] text-gray-500 mt-1">{tssDetail}. Edit to override.</p>
            )}
          </div>
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider block mb-2">Training days</label>
            <div className="flex gap-1.5">
              {DOW_LABELS.map((label, i) => (
                <button
                  key={i}
                  onClick={() => toggleDay(i)}
                  disabled={busy}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    trainingDays.includes(i)
                      ? 'bg-orange-500 text-white'
                      : 'bg-gray-800 text-gray-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider block mb-1">Additional instructions (optional)</label>
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
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-orange-400">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Generating week {Math.min(weekProgress + 1, weeks)} of {weeks}…
            </div>
            <div className="h-1.5 w-full bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-orange-500 transition-all duration-300"
                style={{ width: `${(weekProgress / weeks) * 100}%` }}
              />
            </div>
            <p className="text-[10px] text-gray-500">Each week takes ~25s. Please keep this tab open.</p>
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
