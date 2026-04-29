'use client';

import { PageShell, inputCls, useProfileEdit } from '@/lib/use-profile-edit';

export default function GoalsContent() {
  const { profile, setProfile, save, saving, saved } = useProfileEdit();

  if (!profile) {
    return <PageShell title="Goals"><div className="text-gray-500 text-sm">Loading…</div></PageShell>;
  }

  const goals = profile.goals ?? [];

  function add() {
    setProfile(prev => prev ? { ...prev, goals: [...(prev.goals ?? []), ''] } : prev);
  }
  function updateAt(i: number, value: string) {
    setProfile(prev => {
      if (!prev) return prev;
      return { ...prev, goals: (prev.goals ?? []).map((g, idx) => idx === i ? value : g) };
    });
  }
  function removeAt(i: number) {
    setProfile(prev => prev ? { ...prev, goals: (prev.goals ?? []).filter((_, idx) => idx !== i) } : prev);
  }

  return (
    <PageShell title="Goals">
      <div className="bg-gray-900 rounded-xl p-5 space-y-3 border border-gray-800">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Training Goals</h2>
          <button onClick={add} className="text-sm text-orange-400 hover:text-orange-300 transition-colors">
            + Add goal
          </button>
        </div>

        <p className="text-xs text-gray-500">
          Goals are used by Coach AI when generating training plans and feedback.
        </p>

        {goals.length === 0 && (
          <p className="text-sm text-gray-600 py-1">No goals yet. Add one above.</p>
        )}

        <div className="space-y-2">
          {goals.map((g, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={g}
                onChange={e => updateAt(i, e.target.value)}
                className={inputCls}
                placeholder="e.g. Sub 8:30 at Peaks Challenge, Improve climbing w/kg"
              />
              <button
                onClick={() => removeAt(i)}
                className="flex-shrink-0 text-gray-600 hover:text-red-400 transition-colors px-2 py-1 text-xs"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={() => save()} disabled={saving} className="px-6 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-medium transition-colors">
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save goals'}
        </button>
      </div>
    </PageShell>
  );
}
