'use client';

import { useEffect, useState } from 'react';
import { type ThemePreference, getThemePreference, setThemePreference } from '@/components/ThemeProvider';
import { iconFor } from '@/components/nav-items';
import { PageShell, useProfileEdit } from '@/lib/use-profile-edit';

interface HistoryStatus {
  total:       number;
  oldestDate:  string | null;
  newestDate:  string | null;
  oldestEpoch: number;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface WellnessStatus {
  total:      number;
  oldestDate: string | null;
  newestDate: string | null;
}

export default function SettingsContent() {
  const { profile, update, save, saving, saved } = useProfileEdit();
  const [theme, setTheme] = useState<ThemePreference>('dark');

  // History import state
  const [historyStatus, setHistoryStatus]   = useState<HistoryStatus | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyBusy, setHistoryBusy]       = useState(false);
  const [historyLog, setHistoryLog]         = useState<string[]>([]);
  const [historyDone, setHistoryDone]       = useState(false);

  // intervals.icu sync state
  const [wellnessStatus, setWellnessStatus]   = useState<WellnessStatus | null>(null);
  const [wellnessLoading, setWellnessLoading] = useState(false);
  const [wellnessBusy, setWellnessBusy]       = useState(false);
  const [wellnessLog, setWellnessLog]         = useState<string[]>([]);
  const [intervalsCreds, setIntervalsCreds]   = useState({ id: '', key: '' });

  useEffect(() => { setTheme(getThemePreference()); }, []);

  // Load history status on mount
  useEffect(() => {
    setHistoryLoading(true);
    fetch('/api/strava/history')
      .then(r => r.json())
      .then((d: HistoryStatus) => setHistoryStatus(d))
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, []);

  // Load wellness status + pre-fill credentials from profile on mount
  useEffect(() => {
    setWellnessLoading(true);
    fetch('/api/intervals/sync')
      .then(r => r.json())
      .then((d: WellnessStatus) => setWellnessStatus(d))
      .catch(() => {})
      .finally(() => setWellnessLoading(false));
  }, []);

  // Pre-fill intervals credentials from loaded profile
  useEffect(() => {
    if (profile) {
      setIntervalsCreds({
        id:  profile.intervals_athlete_id ?? '',
        key: profile.intervals_api_key    ?? '',
      });
    }
  }, [profile?.intervals_athlete_id, profile?.intervals_api_key]); // eslint-disable-line react-hooks/exhaustive-deps

  function changeTheme(t: ThemePreference) {
    setTheme(t);
    setThemePreference(t);
  }

  async function runHistoryImport() {
    if (historyBusy) return;
    setHistoryBusy(true);
    setHistoryDone(false);
    setHistoryLog([]);

    let before: number | undefined = historyStatus?.oldestEpoch || undefined;
    let totalSynced = 0;

    try {
      // Loop: fetch batch → if hasMore, use nextBefore for next call
      // Cap at 10 batches (1 000 activities) per button press to avoid
      // an infinite loop in the browser.
      for (let pass = 0; pass < 10; pass++) {
        const res  = await fetch('/api/strava/history', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(before ? { before } : {}),
        });
        const data = await res.json() as {
          synced:     number;
          hasMore:    boolean;
          nextBefore: number | null;
          oldestDate: string | null;
          error?:     string;
        };

        if (data.error) {
          setHistoryLog(l => [...l, `Error: ${data.error}`]);
          break;
        }

        totalSynced += data.synced;
        setHistoryLog(l => [
          ...l,
          `Imported ${data.synced} activities${data.oldestDate ? ` (oldest: ${fmtDate(data.oldestDate)})` : ''}`,
        ]);

        if (!data.hasMore || !data.nextBefore) {
          setHistoryLog(l => [...l, `Done — ${totalSynced} activities imported total.`]);
          setHistoryDone(true);
          break;
        }
        before = data.nextBefore;
      }

      if (!historyDone && totalSynced > 0) {
        setHistoryLog(l => [...l, `Paused after 1 000 activities. Press Import again to continue.`]);
      }

      // Refresh status
      const statusRes = await fetch('/api/strava/history');
      const status    = await statusRes.json() as HistoryStatus;
      setHistoryStatus(status);
    } catch (err) {
      setHistoryLog(l => [...l, `Failed: ${String(err)}`]);
    } finally {
      setHistoryBusy(false);
    }
  }

  async function saveIntervalsCreds() {
    update('intervals_athlete_id', intervalsCreds.id.trim());
    update('intervals_api_key',    intervalsCreds.key.trim());
    await save();
  }

  async function runWellnessSync(days: number) {
    if (wellnessBusy) return;
    // Persist credentials first if they differ from profile
    if (
      intervalsCreds.id.trim()  !== (profile?.intervals_athlete_id ?? '') ||
      intervalsCreds.key.trim() !== (profile?.intervals_api_key    ?? '')
    ) {
      update('intervals_athlete_id', intervalsCreds.id.trim());
      update('intervals_api_key',    intervalsCreds.key.trim());
      await save();
    }

    setWellnessBusy(true);
    setWellnessLog([]);
    try {
      const res  = await fetch('/api/intervals/sync', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ days }),
      });
      const data = await res.json() as { synced?: number; oldestDate?: string; newestDate?: string; error?: string };
      if (data.error) {
        setWellnessLog([`Error: ${data.error}`]);
      } else {
        setWellnessLog([
          `Synced ${data.synced ?? 0} records` +
          (data.oldestDate ? ` (${fmtDate(data.oldestDate)} – ${fmtDate(data.newestDate ?? null)})` : ''),
        ]);
        // Refresh status
        const s = await fetch('/api/intervals/sync').then(r => r.json()) as WellnessStatus;
        setWellnessStatus(s);
      }
    } catch (err) {
      setWellnessLog([`Failed: ${String(err)}`]);
    } finally {
      setWellnessBusy(false);
    }
  }

  if (!profile) {
    return <PageShell title="Settings" icon={iconFor("settings")}><div className="text-gray-500 text-sm">Loading…</div></PageShell>;
  }

  return (
    <PageShell title="Settings" icon={iconFor("settings")}>
      {/* Appearance */}
      <div className="bg-gray-900 rounded-xl p-5 space-y-3 border border-gray-800">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Appearance</h2>
        <div className="grid grid-cols-3 gap-2">
          <button onClick={() => changeTheme('dark')} className={`rounded-xl p-3 border-2 transition-colors text-left ${theme === 'dark' ? 'border-orange-500' : 'border-gray-700 hover:border-gray-600'}`}>
            <div className="flex gap-1 mb-2">
              <div className="w-4 h-4 rounded bg-gray-950 border border-gray-700" />
              <div className="w-4 h-4 rounded bg-gray-800 border border-gray-700" />
              <div className="w-4 h-4 rounded bg-gray-700 border border-gray-700" />
            </div>
            <p className="text-xs font-semibold text-gray-200">Dark</p>
            <p className="text-[10px] text-gray-500 mt-0.5">Always dark</p>
          </button>
          <button onClick={() => changeTheme('auto')} className={`rounded-xl p-3 border-2 transition-colors text-left ${theme === 'auto' ? 'border-orange-500' : 'border-gray-700 hover:border-gray-600'}`}>
            <div className="flex gap-1 mb-2">
              <div className="w-4 h-4 rounded" style={{ background: 'linear-gradient(135deg, #030712 50%, #f8fafc 50%)' }} />
              <div className="w-4 h-4 rounded bg-orange-500/30 border border-orange-500/50" />
            </div>
            <p className="text-xs font-semibold text-gray-200">Auto</p>
            <p className="text-[10px] text-gray-500 mt-0.5">7am–7pm light</p>
          </button>
          <button onClick={() => changeTheme('light')} className={`rounded-xl p-3 border-2 transition-colors text-left ${theme === 'light' ? 'border-orange-500' : 'border-gray-700 hover:border-gray-600'}`}>
            <div className="flex gap-1 mb-2">
              <div className="w-4 h-4 rounded bg-white border border-gray-300" />
              <div className="w-4 h-4 rounded bg-slate-100 border border-gray-300" />
              <div className="w-4 h-4 rounded bg-slate-200 border border-gray-300" />
            </div>
            <p className="text-xs font-semibold text-gray-200">Light</p>
            <p className="text-[10px] text-gray-500 mt-0.5">Always light</p>
          </button>
        </div>
      </div>

      {/* Coach AI Persona */}
      <div className="bg-gray-900 rounded-xl p-5 space-y-3 border border-gray-800">
        <div>
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Coach AI Persona</h2>
          <p className="text-xs text-gray-500 mt-1">Describe how you want your coach to communicate. Leave blank for the default style.</p>
        </div>
        <textarea
          value={profile.coach_persona ?? ''}
          onChange={e => update('coach_persona', e.target.value)}
          rows={3}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-orange-500"
          placeholder="e.g. Direct and no-nonsense. Skip the encouragement, just give me the numbers and the plan."
        />
      </div>

      {/* Physical — used for event pacing calculations */}
      <div className="bg-gray-900 rounded-xl p-5 space-y-3 border border-gray-800">
        <div>
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Physical</h2>
          <p className="text-xs text-gray-500 mt-1">Used for climb time estimates and pacing strategy calculations.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Rider Weight (kg)</label>
            <input
              type="number"
              value={profile.weight_kg ?? ''}
              onChange={e => update('weight_kg', e.target.value ? Number(e.target.value) : null)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              placeholder="75"
              step={0.5}
              min={40}
              max={150}
            />
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Bike Weight (kg)</label>
            <input
              type="number"
              value={profile.bike_weight_kg ?? ''}
              onChange={e => update('bike_weight_kg', e.target.value ? Number(e.target.value) : null)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              placeholder="8"
              step={0.5}
              min={3}
              max={20}
            />
          </div>
        </div>
      </div>

      {/* Strava Connection */}
      <div className="bg-gray-900 rounded-xl p-5 space-y-4 border border-gray-800">
        <div>
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Strava Connection</h2>
          <p className="text-xs text-gray-500 mt-1">
            Re-authorise to grant access to routes and segments. Required to load Strava courses on event pages.
          </p>
        </div>
        <a
          href="/api/strava/auth"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
          </svg>
          Reconnect Strava
        </a>

        {/* Activity history import */}
        <div className="border-t border-gray-800 pt-4 space-y-3">
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Import Activity History</h3>
            <p className="text-xs text-gray-500 mt-1">
              Pull in older activities from Strava that aren&apos;t yet in the database.
              Imports up to 1 000 activities per press, oldest first.
            </p>
          </div>

          {/* Status strip */}
          {historyLoading ? (
            <p className="text-xs text-gray-600">Loading…</p>
          ) : historyStatus ? (
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-gray-800 rounded-lg p-2.5 text-center">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Stored</p>
                <p className="text-base font-bold text-white mt-0.5">{historyStatus.total.toLocaleString()}</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-2.5 text-center">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Newest</p>
                <p className="text-[11px] font-semibold text-white mt-0.5">{fmtDate(historyStatus.newestDate)}</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-2.5 text-center">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Oldest</p>
                <p className="text-[11px] font-semibold text-white mt-0.5">{fmtDate(historyStatus.oldestDate)}</p>
              </div>
            </div>
          ) : null}

          <button
            onClick={runHistoryImport}
            disabled={historyBusy}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {historyBusy ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" strokeOpacity={0.25} />
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
                Importing…
              </>
            ) : historyDone ? (
              'Import complete ✓'
            ) : (
              'Import older activities'
            )}
          </button>

          {/* Progress log */}
          {historyLog.length > 0 && (
            <div className="bg-gray-950 rounded-lg p-3 space-y-1 max-h-32 overflow-y-auto">
              {historyLog.map((line, i) => (
                <p key={i} className="text-[11px] text-gray-400 font-mono">{line}</p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* intervals.icu Integration */}
      <div className="bg-gray-900 rounded-xl p-5 space-y-4 border border-gray-800">
        <div>
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">intervals.icu</h2>
          <p className="text-xs text-gray-500 mt-1">
            Sync daily HRV, readiness score, and sleep score to power the Readiness dashboard.
            Find your Athlete ID in your intervals.icu URL: <span className="text-gray-400 font-mono">intervals.icu/athlete/</span><span className="text-orange-400 font-mono">i12345</span>.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Athlete ID</label>
            <input
              type="text"
              value={intervalsCreds.id}
              onChange={e => setIntervalsCreds(c => ({ ...c, id: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500 font-mono"
              placeholder="i12345"
            />
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">API Key</label>
            <input
              type="password"
              value={intervalsCreds.key}
              onChange={e => setIntervalsCreds(c => ({ ...c, key: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500 font-mono"
              placeholder="••••••••••••••••"
            />
          </div>
        </div>

        {/* Wellness DB status */}
        {!wellnessLoading && wellnessStatus && wellnessStatus.total > 0 && (
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-gray-800 rounded-lg p-2.5 text-center">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Stored</p>
              <p className="text-base font-bold text-white mt-0.5">{wellnessStatus.total.toLocaleString()}</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-2.5 text-center">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Newest</p>
              <p className="text-[11px] font-semibold text-white mt-0.5">{fmtDate(wellnessStatus.newestDate)}</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-2.5 text-center">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Oldest</p>
              <p className="text-[11px] font-semibold text-white mt-0.5">{fmtDate(wellnessStatus.oldestDate)}</p>
            </div>
          </div>
        )}

        {/* Sync buttons */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => runWellnessSync(90)}
            disabled={wellnessBusy || !intervalsCreds.id || !intervalsCreds.key}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {wellnessBusy ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" strokeOpacity={0.25} />
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
                Syncing…
              </>
            ) : 'Sync last 90 days'}
          </button>
          <button
            onClick={() => runWellnessSync(365)}
            disabled={wellnessBusy || !intervalsCreds.id || !intervalsCreds.key}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 text-sm font-medium transition-colors border border-gray-700"
          >
            Backfill 1 year
          </button>
          <button
            onClick={saveIntervalsCreds}
            disabled={saving || !intervalsCreds.id || !intervalsCreds.key}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 disabled:opacity-50 text-orange-400 text-sm font-medium transition-colors border border-orange-500/30"
          >
            Save credentials
          </button>
        </div>

        {/* Sync log */}
        {wellnessLog.length > 0 && (
          <div className="bg-gray-950 rounded-lg p-3 space-y-1">
            {wellnessLog.map((line, i) => (
              <p key={i} className="text-[11px] text-gray-400 font-mono">{line}</p>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button onClick={() => save()} disabled={saving} className="px-6 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-medium transition-colors">
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save settings'}
        </button>
      </div>
    </PageShell>
  );
}
