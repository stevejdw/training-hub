'use client';

import { useEffect, useState } from 'react';

export type DeleteScope = 'activity' | 'power' | 'hr';

const DELETE_ACTIONS: Record<DeleteScope, { label: string; confirm: string }> = {
  activity: {
    label:   'Delete activity',
    confirm: 'Delete this activity along with its laps, streams, segment efforts and best-power records? It will not be re-imported on the next Strava sync.',
  },
  power: {
    label:   'Remove power data',
    confirm: 'Remove all power data from this activity — average/normalised/max watts, the power stream, best-power efforts and lap power? TSS falls back to heart rate where available.',
  },
  hr: {
    label:   'Remove heart rate data',
    confirm: 'Remove all heart rate data from this activity — average/max HR, the HR stream, lap HR and suffer score?',
  },
};

interface GearOption {
  id: string;
  name: string | null;
  nickname: string | null;
  retired: boolean | null;
  /** Garmin's service window for the bike; either end may be open. */
  date_begin: string | null;
  date_end: string | null;
}

interface Props {
  activityId: string;
  name: string;
  /** ISO start of the ride — decides which bikes were in service for it. */
  startDate: string;
  gearId: string | null;
  hasPower: boolean;
  hasHr: boolean;
  onClose: () => void;
  /** Name/gear saved — parent patches its local activity. */
  onSaved: (patch: { name: string; gear_id: string | null; gear_name: string | null }) => void;
  /** A power/HR channel was removed — parent re-reads the activity. */
  onDataRemoved: () => void;
  /** The whole activity was deleted — parent navigates away. */
  onActivityDeleted: () => void;
}

export default function ActivityEditModal({
  activityId, name, startDate, gearId, hasPower, hasHr,
  onClose, onSaved, onDataRemoved, onActivityDeleted,
}: Props) {
  const [nameDraft, setNameDraft] = useState(name);
  const [gearDraft, setGearDraft] = useState<string>(gearId ?? '');
  const [gear, setGear]           = useState<GearOption[]>([]);
  const [showAllGear, setShowAllGear] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error,  setError]        = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<DeleteScope | null>(null);
  const [deleting, setDeleting]           = useState(false);

  useEffect(() => {
    fetch('/api/gear?all=1')
      .then(r => r.json())
      .then(d => setGear(d.gear ?? []))
      .catch(() => setGear([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const gearLabel = (g: GearOption) => (g.nickname || g.name || g.id) + (g.retired ? ' (retired)' : '');

  // Offer the bikes that were actually in service on the day of this ride,
  // not the whole fleet. A bike retired in 2023 is still the right answer for
  // a 2022 ride and the wrong one for today's, which the retired flag alone
  // cannot express. Dates come from Garmin; a bike it has never seen falls
  // back to the retired flag rather than being dropped outright, so gear that
  // only ever existed in Strava stays pickable.
  const rideDay = startDate.slice(0, 10);
  const inServiceOnRideDay = (g: GearOption) => {
    if (!g.date_begin && !g.date_end) return !g.retired;
    return (
      (!g.date_begin || g.date_begin.slice(0, 10) <= rideDay) &&
      (!g.date_end || rideDay <= g.date_end.slice(0, 10))
    );
  };
  // The bike already on the ride always stays selectable, whatever the dates
  // say — otherwise saving a rename would silently clear the gear.
  const gearOptions = gear.filter(
    g => showAllGear || g.id === gearDraft || inServiceOnRideDay(g)
  );
  const hiddenCount = gear.length - gearOptions.length;
  const busy = saving || deleting;
  const dirty = nameDraft.trim() !== name || (gearDraft || null) !== (gearId ?? null);

  async function save() {
    const next = nameDraft.trim();
    if (!next) { setError('Name cannot be empty'); return; }
    if (!dirty) { onClose(); return; }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/activities/${activityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: next, gear_id: gearDraft || null }),
      });
      const body = await r.json().catch(() => ({})) as { error?: string; activity?: { name: string; gear_id: string | null; gear_name: string | null } };
      if (!r.ok) throw new Error(body.error ?? `Request failed (${r.status})`);
      onSaved({
        name:      body.activity?.name ?? next,
        gear_id:   body.activity?.gear_id ?? (gearDraft || null),
        gear_name: body.activity?.gear_name ?? null,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function runDelete(scope: DeleteScope) {
    setDeleting(true);
    setError(null);
    try {
      const r = await fetch(`/api/activities/${activityId}?scope=${scope}`, { method: 'DELETE' });
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Request failed (${r.status})`);
      }
      if (scope === 'activity') { onActivityDeleted(); return; }
      onDataRemoved();
      setPendingDelete(null);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  const scopes: DeleteScope[] = [
    ...(hasPower ? ['power' as const] : []),
    ...(hasHr    ? ['hr'    as const] : []),
    'activity',
  ];

  return (
    // Leaflet panes/controls reach z-index 1000, so the overlay has to clear
    // that or the activity map paints over the modal.
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 px-4 pt-[calc(1rem_+_env(safe-area-inset-top))] pb-[calc(89px_+_env(safe-area-inset-bottom))] md:pt-4 md:pb-4">
      <div className="bg-surface border border-line-strong rounded-2xl w-full max-w-md max-h-[calc(100vh_-_73px_-_2rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] md:max-h-[90vh] flex flex-col">
        <div className="p-6 overflow-y-auto flex-1 min-h-0 space-y-5">

          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ink">Edit activity</h2>
            <button onClick={onClose} disabled={busy} className="text-ink-4 hover:text-ink transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div>
            <label className="text-xs text-ink-3 uppercase tracking-wider block mb-1">Name</label>
            <input
              autoFocus
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
              disabled={busy}
              className="w-full bg-raised border border-line-strong rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent disabled:opacity-50"
            />
          </div>

          <div>
            <label className="text-xs text-ink-3 uppercase tracking-wider block mb-1">Gear</label>
            <select
              value={gearDraft}
              onChange={e => setGearDraft(e.target.value)}
              disabled={busy}
              className="w-full bg-raised border border-line-strong rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent disabled:opacity-50"
            >
              <option value="">No gear</option>
              {gearOptions.map(g => (
                <option key={g.id} value={g.id}>{gearLabel(g)}</option>
              ))}
            </select>
            {(hiddenCount > 0 || showAllGear) && (
              <label className="mt-1.5 flex items-center gap-2 text-mini text-ink-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showAllGear}
                  onChange={e => setShowAllGear(e.target.checked)}
                  disabled={busy}
                  className="accent-accent"
                />
                Show all bikes{hiddenCount > 0 ? ` (${hiddenCount} not in service then)` : ''}
              </label>
            )}
            <p className="mt-1 text-mini text-ink-5">
              Only bikes in service on the day of this ride are listed. Bikes and their dates
              mirror Garmin; renaming one is done from the gear filter on Activities.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={busy || !nameDraft.trim()}
              className="flex-1 px-3 py-2 rounded-lg bg-accent hover:bg-accent-hi disabled:opacity-50 text-ink text-sm font-semibold transition-colors"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button
              onClick={onClose}
              disabled={busy}
              className="px-3 py-2 rounded-lg bg-raised hover:bg-hover disabled:opacity-50 text-ink-2 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
          </div>

          <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-4">
            <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-1">Delete data</p>
            <p className="text-xs text-ink-4 mb-3">
              Deletions are permanent and are remembered, so a Strava re-sync won&apos;t bring the data back.
            </p>

            {pendingDelete ? (
              <div className="space-y-3">
                <p className="text-sm text-ink-2">{DELETE_ACTIONS[pendingDelete].confirm}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => runDelete(pendingDelete)}
                    disabled={busy}
                    className="px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-ink text-sm font-semibold transition-colors"
                  >
                    {deleting ? 'Deleting…' : `Yes, ${DELETE_ACTIONS[pendingDelete].label.toLowerCase()}`}
                  </button>
                  <button
                    onClick={() => { setPendingDelete(null); setError(null); }}
                    disabled={busy}
                    className="px-3 py-2 rounded-lg bg-raised hover:bg-hover disabled:opacity-50 text-ink-2 text-sm font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {scopes.map(scope => (
                  <button
                    key={scope}
                    onClick={() => { setPendingDelete(scope); setError(null); }}
                    disabled={busy}
                    className="px-3 py-2 rounded-lg border border-red-800/60 bg-red-900/20 hover:bg-red-900/40 disabled:opacity-50 text-red-300 text-sm font-medium transition-colors"
                  >
                    {DELETE_ACTIONS[scope].label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

        </div>
      </div>
    </div>
  );
}
