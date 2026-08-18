'use client';

import { useEffect, useState } from 'react';
import { type ThemePreference, getThemePreference, setThemePreference } from '@/components/ThemeProvider';
import { iconFor } from '@/components/nav-items';
import { PageShell, useProfileEdit } from '@/lib/use-profile-edit';
import TrainingPlansSettings from '@/components/training/TrainingPlansSettings';
import SaveStatus from '@/components/ui/SaveStatus';
import { CHART } from '@/lib/chart-theme';

interface HistoryStatus {
  total:       number;
  oldestDate:  string | null;
  newestDate:  string | null;
  oldestEpoch: number;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

interface WellnessStatus {
  total:      number;
  oldestDate: string | null;
  newestDate: string | null;
}

interface SyncHealth {
  primary: string;
  intervalsWellness: boolean;
  providers: { provider: string; lastOkAt: string | null; lastError: string | null; detail: string | null; stale: boolean }[];
  garmin?: { connected: boolean; status: string; lastOkAt: string | null; lastError: string | null } | null;
}

function sinceLabel(iso: string | null): string {
  if (!iso) return 'never';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

type SettingsTab = 'appearance' | 'coaching' | 'you' | 'connections' | 'data';

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'appearance',  label: 'Appearance'  },
  { id: 'coaching',    label: 'Coaching'    },
  { id: 'you',         label: 'You'         },
  { id: 'connections', label: 'Connections' },
  { id: 'data',        label: 'Data'        },
];

export default function SettingsContent() {
  const [tab, setTab] = useState<SettingsTab>('appearance');
  const { profile, update, updateAndSave, save, saving, saved, error } = useProfileEdit();
  const [theme, setTheme] = useState<ThemePreference>('dark');

  // History import state
  const [historyStatus, setHistoryStatus]   = useState<HistoryStatus | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyBusy, setHistoryBusy]       = useState(false);
  const [historyLog, setHistoryLog]         = useState<string[]>([]);
  const [historyDone, setHistoryDone]       = useState(false);

  // Strava recent sync state
  const [stravaSyncing, setStravaSyncing] = useState(false);
  const [stravaSyncLog, setStravaSyncLog] = useState<string[]>([]);

  // Power meter backfill state
  const [pmSyncing, setPmSyncing] = useState(false);
  const [pmSyncLog, setPmSyncLog] = useState<string[]>([]);

  // Sync health strip — with one active source there's no redundancy, so a
  // stalled provider has to be visible rather than inferred.
  const [health, setHealth] = useState<SyncHealth | null>(null);

  // intervals.icu sync state
  const [wellnessStatus, setWellnessStatus]   = useState<WellnessStatus | null>(null);
  const [wellnessLoading, setWellnessLoading] = useState(false);
  const [wellnessBusy, setWellnessBusy]       = useState(false);
  const [wellnessLog, setWellnessLog]         = useState<string[]>([]);
  const [intervalsCreds, setIntervalsCreds]   = useState({ id: '', key: '' });

  useEffect(() => { setTheme(getThemePreference()); }, []);

  useEffect(() => {
    fetch('/api/sync/health')
      .then(r => r.json())
      .then((d: SyncHealth) => setHealth(d))
      .catch(() => {});
  }, [profile?.primary_source]);

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

  // Pre-fill the athlete ID from the loaded profile. The API key is never sent
  // to the browser — the field stays blank and an empty value means "leave the
  // stored key alone" (see app/api/profile/route.ts).
  useEffect(() => {
    if (profile) {
      setIntervalsCreds({ id: profile.intervals_athlete_id ?? '', key: '' });
    }
  }, [profile?.intervals_athlete_id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    let finished = false;

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
          finished = true;
          break;
        }
        before = data.nextBefore;
      }

      // Loop-local, not the `historyDone` state: setState is async, so reading
      // the state here would always see `false` and wrongly report a pause.
      if (!finished && totalSynced > 0) {
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

  async function runStravaSync() {
    if (stravaSyncing) return;
    setStravaSyncing(true);
    setStravaSyncLog([]);
    async function doSync(): Promise<{ synced?: number; error?: string }> {
      const r = await fetch('/api/sync', { method: 'POST' });
      const text = await r.text();
      try { return JSON.parse(text) as { synced?: number; error?: string }; }
      catch { throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`); }
    }
    try {
      let d: { synced?: number; error?: string };
      try { d = await doSync(); if (d.error) throw new Error(d.error); }
      catch {
        await new Promise(res => setTimeout(res, 500));
        d = await doSync();
        if (d.error) throw new Error(d.error);
      }
      setStravaSyncLog([d.synced === 0 ? 'Already up to date' : `Synced ${d.synced} new activit${d.synced === 1 ? 'y' : 'ies'}`]);
    } catch (err) {
      setStravaSyncLog([`Failed: ${String(err)}`]);
    } finally {
      setStravaSyncing(false);
    }
  }

  async function runPmBackfill() {
    if (pmSyncing) return;
    setPmSyncing(true);
    setPmSyncLog([]);
    try {
      const res = await fetch('/api/activities/backfill-power-meter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const d = await res.json() as { updated?: number; icu_with_power_meter?: number; error?: string };
      if (d.error) throw new Error(d.error);
      if ((d.updated ?? 0) > 0) {
        setPmSyncLog([`Updated ${d.updated} of ${d.icu_with_power_meter} activities with power meter data`]);
      } else {
        setPmSyncLog([`Already up to date — ${d.icu_with_power_meter ?? 0} activities have power meter data`]);
      }
    } catch (err) {
      setPmSyncLog([`Failed: ${String(err)}`]);
    } finally {
      setPmSyncing(false);
    }
  }

  async function saveIntervalsCreds() {
    update('intervals_athlete_id', intervalsCreds.id.trim());
    // Only send a key when one was actually typed. An empty field means
    // "unchanged", so saving the athlete ID alone can't wipe the stored key.
    if (intervalsCreds.key.trim()) update('intervals_api_key', intervalsCreds.key.trim());
    await save();
  }

  async function runWellnessSync(days: number) {
    if (wellnessBusy) return;
    // Persist credentials first if the ID changed or a new key was typed. The
    // stored key is never readable here, so a blank field can't be compared —
    // it just means "unchanged".
    if (
      intervalsCreds.id.trim() !== (profile?.intervals_athlete_id ?? '') ||
      intervalsCreds.key.trim()
    ) {
      await saveIntervalsCreds();
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
    return <PageShell title="Settings" icon={iconFor("settings")}><div className="text-ink-4 text-sm">Loading…</div></PageShell>;
  }

  return (
    <PageShell title="Settings" icon={iconFor("settings")}>
      {/* Nine stacked sections in one scroll was the "busy" complaint. Five
          short screens fixes it; an accordion would just hide the density. */}
      <nav className="flex gap-1 overflow-x-auto scroll-touch -mx-1 px-1 pb-1">
        {SETTINGS_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              tab === t.id
                ? 'bg-accent text-ink'
                : 'bg-raised text-ink-3 hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'appearance' && (<>
      {/* Appearance */}
      <div className="bg-surface rounded-xl p-5 space-y-4 border border-line">
        <h2 className="text-sm font-semibold text-ink-2 uppercase tracking-wider">Appearance</h2>

        {/* 3 theme families, each with dark + light variant */}
        <div className="space-y-2">
          {([
            {
              name: 'Carbon',
              dark:  { id: 'dark'        as const, bg: '#030712', card: '#111827', accent: '#f97316' },
              light: { id: 'light'       as const, bg: '#f8fafc', card: '#ffffff',  accent: '#f97316' },
            },
            {
              name: 'Ocean',
              dark:  { id: 'ocean'       as const, bg: '#000d1a', card: '#00172e', accent: '#0ea5e9' },
              light: { id: 'ocean-light' as const, bg: '#f0f9ff', card: '#ffffff',  accent: '#0ea5e9' },
            },
            {
              name: 'Sand',
              dark:  { id: 'sand-dark'   as const, bg: '#1a100a', card: '#261510', accent: '#0ea5e9' },
              light: { id: 'sand'        as const, bg: '#f8f4ef', card: '#ffffff',  accent: '#0369a1' },
            },
          ]).map(family => {
            const darkActive  = theme === family.dark.id;
            const lightActive = theme === family.light.id;
            const anyActive   = darkActive || lightActive;
            return (
              <div key={family.name} className={`rounded-xl border-2 overflow-hidden transition-colors ${anyActive ? 'border-accent' : 'border-line-strong'}`}>
                <div className="px-3 pt-2.5 pb-1 text-micro font-semibold text-ink-4 uppercase tracking-wider">{family.name}</div>
                <div className="grid grid-cols-2">
                  {([
                    { variant: family.dark,  label: 'Dark',  side: 0 },
                    { variant: family.light, label: 'Light', side: 1 },
                  ]).map(({ variant, label, side }) => {
                    const isActive = theme === variant.id;
                    return (
                      <button
                        key={variant.id}
                        onClick={() => changeTheme(variant.id)}
                        className={`p-3 text-left transition-colors border-t border-line-strong ${side === 0 ? 'border-r border-line-strong' : ''} ${isActive ? 'bg-accent/10' : 'hover:bg-raised'}`}
                      >
                        <div className="flex gap-1.5 mb-2">
                          <div className="w-4 h-4 rounded" style={{ background: variant.bg }} />
                          <div className="w-4 h-4 rounded" style={{ background: variant.card, border: variant.card === CHART.tooltipText ? '1px solid #d1d5db' : undefined }} />
                          <div className="w-4 h-4 rounded" style={{ background: variant.accent }} />
                        </div>
                        <p className={`text-xs font-semibold ${isActive ? 'text-accent-hi' : 'text-ink-2'}`}>{label}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Auto toggle — switches Carbon between dark and light by time of day */}
        <button
          onClick={() => changeTheme('auto')}
          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-colors ${theme === 'auto' ? 'border-accent bg-accent/10' : 'border-line-strong hover:border-line-hover'}`}
        >
          <div className="text-left">
            <p className={`text-xs font-semibold ${theme === 'auto' ? 'text-accent-hi' : 'text-ink-2'}`}>Auto</p>
            <p className="text-micro text-ink-4 mt-0.5">Switch Carbon between dark and light at 7am / 7pm</p>
          </div>
          <div className="flex gap-1 flex-shrink-0 ml-3">
            <div className="w-4 h-4 rounded" style={{ background: 'linear-gradient(135deg, #030712 50%, #f8fafc 50%)' }} />
            <div className="w-4 h-4 rounded" style={{ background: CHART.power }} />
          </div>
        </button>

        {/* App icon */}
        <div className="space-y-2">
          <p className="text-micro font-semibold text-ink-4 uppercase tracking-wider">Home Screen Icon</p>
          <div className="grid grid-cols-4 gap-2">
            {([
              { id: 'gear'       as const, label: 'Gear'       },
              { id: 'minimalist' as const, label: 'Minimal'    },
              { id: 'path'       as const, label: 'Path'       },
              { id: 'speed'      as const, label: 'Speed'      },
            ]).map(({ id, label }) => {
              const active = (profile.app_icon ?? 'speed') === id;
              return (
                <button
                  key={id}
                  onClick={() => { void updateAndSave('app_icon', id); }}
                  className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border-2 transition-colors ${active ? 'border-accent bg-accent/10' : 'border-line-strong hover:border-line-hover'}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/app-icon-${id}.png`} alt={label} className="w-14 h-14 rounded-xl object-cover" />
                  <span className={`text-micro font-semibold ${active ? 'text-accent-hi' : 'text-ink-3'}`}>{label}</span>
                </button>
              );
            })}
          </div>
          <p className="text-micro text-ink-5">Takes effect when you re-add the app to your home screen.</p>
        </div>
      </div>

      </>)}
      {tab === 'coaching' && (<>
      {/* AI Settings */}
      <div className="bg-surface rounded-xl p-5 space-y-4 border border-line">
        <div>
          <h2 className="text-sm font-semibold text-ink-2 uppercase tracking-wider">AI Settings</h2>
          <p className="text-xs text-ink-4 mt-1">
            Give the coaching AI specific guidance on how it should communicate, give feedback, and build training plans. 
            The more specific you are, the more tailored the results.
          </p>
        </div>

        {/* Persona */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-accent-hi flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <label className="text-xs font-semibold text-ink-3 uppercase tracking-wider">Coach Persona</label>
          </div>
          <p className="text-micro text-ink-4 leading-relaxed">
            How would you describe the ideal coach? This sets the overall identity and tone.
          </p>
          <textarea
            value={profile.coach_persona ?? ''}
            onChange={e => update('coach_persona', e.target.value)}
            rows={2}
            className="w-full bg-raised border border-line-strong rounded-lg px-3 py-2 text-sm text-ink resize-none focus:outline-none focus:border-accent"
            placeholder="e.g. You are an experienced but approachable coach who balances hard truths with genuine belief in the athlete's potential. You've coached dozens of amateur racers."
          />
          <div className="flex gap-1.5 flex-wrap">
            {[
              'Direct and no-nonsense. Skip encouragement, just give me the numbers',
              'Supportive and enthusiastic. Always find something positive, then give feedback',
              'Scientific and detail-oriented. Reference research and explain the why',
              'Hard-ass military coach. Tough love, short, blunt',
            ].map(s => (
              <button key={s} onClick={() => update('coach_persona', s)} className={`text-micro px-2 py-1 rounded-md border transition-colors ${(profile.coach_persona ?? '') === s ? 'border-accent bg-accent/10 text-accent-hi' : 'border-line-strong text-ink-4 hover:border-line-hover'}`}>
                {s.startsWith('Direct') ? 'Direct' : s.startsWith('Supportive') ? 'Supportive' : s.startsWith('Scientific') ? 'Scientific' : 'Tough love'}
              </button>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-line" />

        {/* Coaching Feedback Guidance */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-accent-hi flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <label className="text-xs font-semibold text-ink-3 uppercase tracking-wider">Ride Feedback Style</label>
          </div>
          <p className="text-micro text-ink-4 leading-relaxed">
            How should the AI analyse and give feedback on your rides? Length, depth, what to focus on.
          </p>
          <textarea
            value={profile.ai_coaching_feedback ?? ''}
            onChange={e => update('ai_coaching_feedback', e.target.value)}
            rows={2}
            className="w-full bg-raised border border-line-strong rounded-lg px-3 py-2 text-sm text-ink resize-none focus:outline-none focus:border-accent"
            placeholder="e.g. Keep it to 3–4 sentences. Don't restate my lap data — I can read that. Compare my interval power to the previous 3 similar sessions and tell me if I'm improving."
          />
          <div className="flex gap-1.5 flex-wrap">
            {[
              'Brief insight only: 2–3 sentences, one key takeaway, no numbers I can see on the page',
              'Detailed analysis: compare to recent trend, highlight HR decoupling, give a specific next focus',
              'Minimal feedback: just tell me if it was a good session or not and what to do next time',
              'Full breakdown: lap-by-lap power, HR drift, VI, and a suggested adjustment for next session',
            ].map(s => (
              <button key={s} onClick={() => update('ai_coaching_feedback', s)} className={`text-micro px-2 py-1 rounded-md border transition-colors ${(profile.ai_coaching_feedback ?? '') === s ? 'border-accent bg-accent/10 text-accent-hi' : 'border-line-strong text-ink-4 hover:border-line-hover'}`}>
                {s.startsWith('Brief') ? 'Brief' : s.startsWith('Detailed') ? 'Detailed' : s.startsWith('Minimal') ? 'Minimal' : 'Full'}
              </button>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-line" />

        {/* Training Plan Guidance */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-accent-hi flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <label className="text-xs font-semibold text-ink-3 uppercase tracking-wider">Training Plan Approach</label>
          </div>
          <p className="text-micro text-ink-4 leading-relaxed">
            What philosophy or constraints should guide training plan generation? Volume preference, intensity bias, periodisation style.
          </p>
          <textarea
            value={profile.ai_training_plan_guidance ?? ''}
            onChange={e => update('ai_training_plan_guidance', e.target.value)}
            rows={2}
            className="w-full bg-raised border border-line-strong rounded-lg px-3 py-2 text-sm text-ink resize-none focus:outline-none focus:border-accent"
            placeholder="e.g. Polarised approach: 80% Z2, 20% hard. Prefer longer intervals (8–20 min) over short sprints. Avoid more than 2 hard days per week."
          />
          <div className="flex gap-1.5 flex-wrap">
            {[
              'Polarised: 80% easy Z2, 20% hard work. Long intervals preferred (8–20 min). Max 2 hard days/week',
              'Sweet spot: mostly tempo/threshold work. 3–4 hard days per week, lower total volume',
              'Traditional base-build-peak: long Z2 blocks early, introduce intensity later',
              'Low volume, high intensity: 2 rides per week, both high quality. Prioritise VO2 and threshold',
            ].map(s => (
              <button key={s} onClick={() => update('ai_training_plan_guidance', s)} className={`text-micro px-2 py-1 rounded-md border transition-colors ${(profile.ai_training_plan_guidance ?? '') === s ? 'border-accent bg-accent/10 text-accent-hi' : 'border-line-strong text-ink-4 hover:border-line-hover'}`}>
                {s.startsWith('Polarised') ? 'Polarised' : s.startsWith('Sweet') ? 'Sweet spot' : s.startsWith('Traditional') ? 'Traditional' : 'Low vol / high int'}
              </button>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-line" />

        {/* Communication Style */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-accent-hi flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <label className="text-xs font-semibold text-ink-3 uppercase tracking-wider">Communication Style</label>
          </div>
          <p className="text-micro text-ink-4 leading-relaxed">
            Tone, length, and structure for chat conversations. How formal, how much detail, use of emoji / markdown.
          </p>
          <textarea
            value={profile.ai_communication_style ?? ''}
            onChange={e => update('ai_communication_style', e.target.value)}
            rows={2}
            className="w-full bg-raised border border-line-strong rounded-lg px-3 py-2 text-sm text-ink resize-none focus:outline-none focus:border-accent"
            placeholder="e.g. Casual and conversational. Use some emoji. Be concise — I don't need paragraphs. Skip the markdown tables."
          />
          <div className="flex gap-1.5 flex-wrap">
            {[
              'Casual and concise. Use some emoji. No markdown tables. Keep responses under 4 sentences unless I ask for detail',
              'Professional and structured. Use markdown headings and bullet points when useful. Reference numbers specifically',
              'Minimalist. Just give me the answer. No fluff, no emoji, no formatting',
              'Conversational and thorough. Explain your reasoning. Use analogies. Don\'t be afraid to be detailed',
            ].map(s => (
              <button key={s} onClick={() => update('ai_communication_style', s)} className={`text-micro px-2 py-1 rounded-md border transition-colors ${(profile.ai_communication_style ?? '') === s ? 'border-accent bg-accent/10 text-accent-hi' : 'border-line-strong text-ink-4 hover:border-line-hover'}`}>
                {s.startsWith('Casual') ? 'Casual' : s.startsWith('Professional') ? 'Professional' : s.startsWith('Minimalist') ? 'Minimalist' : 'Conversational'}
              </button>
            ))}
          </div>
        </div>
      </div>

      </>)}
      {tab === 'you' && (<>
      {/* Timezone */}
      <div className="bg-surface rounded-xl p-5 space-y-3 border border-line">
        <div>
          <h2 className="text-sm font-semibold text-ink-2 uppercase tracking-wider">Timezone</h2>
          <p className="text-xs text-ink-4 mt-1">
            All dates and times throughout the app will use this timezone. Used for training plan generation, activity dates, and calendar views.
          </p>
        </div>
        <select
          value={profile.timezone || 'Australia/Sydney'}
          onChange={e => update('timezone', e.target.value)}
          className="w-full bg-raised border border-line-strong rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent"
        >
          <option value="Pacific/Auckland">Pacific/Auckland (UTC+12/+13)</option>
          <option value="Australia/Sydney">Australia/Sydney (UTC+10/+11)</option>
          <option value="Australia/Melbourne">Australia/Melbourne (UTC+10/+11)</option>
          <option value="Australia/Brisbane">Australia/Brisbane (UTC+10)</option>
          <option value="Australia/Adelaide">Australia/Adelaide (UTC+9:30/+10:30)</option>
          <option value="Australia/Perth">Australia/Perth (UTC+8)</option>
          <option value="Asia/Tokyo">Asia/Tokyo (UTC+9)</option>
          <option value="Asia/Shanghai">Asia/Shanghai (UTC+8)</option>
          <option value="Asia/Singapore">Asia/Singapore (UTC+8)</option>
          <option value="Asia/Kolkata">Asia/Kolkata (UTC+5:30)</option>
          <option value="Europe/London">Europe/London (UTC+0/+1)</option>
          <option value="Europe/Paris">Europe/Paris (UTC+1/+2)</option>
          <option value="Europe/Berlin">Europe/Berlin (UTC+1/+2)</option>
          <option value="America/New_York">America/New_York (UTC-5/-4)</option>
          <option value="America/Chicago">America/Chicago (UTC-6/-5)</option>
          <option value="America/Denver">America/Denver (UTC-7/-6)</option>
          <option value="America/Los_Angeles">America/Los_Angeles (UTC-8/-7)</option>
          <option value="America/Vancouver">America/Vancouver (UTC-8/-7)</option>
          <option value="America/Toronto">America/Toronto (UTC-5/-4)</option>
          <option value="UTC">UTC</option>
        </select>
      </div>

      {/* Physical — used for event pacing calculations */}
      <div className="bg-surface rounded-xl p-5 space-y-3 border border-line">

        <div>
          <h2 className="text-sm font-semibold text-ink-2 uppercase tracking-wider">Physical</h2>
          <p className="text-xs text-ink-4 mt-1">Used for climb time estimates and pacing strategy calculations.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-micro text-ink-4 uppercase tracking-wider mb-1">Max Heart Rate</label>
            <input
              type="number"
              value={profile.max_hr ?? ''}
              onChange={e => update('max_hr', e.target.value ? Number(e.target.value) : null)}
              className="w-full bg-raised border border-line-strong rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent"
              placeholder="193"
              step={1}
              min={100}
              max={250}
            />
          </div>
          <div>
            <label className="block text-micro text-ink-4 uppercase tracking-wider mb-1">Lactate Threshold HR</label>
            <input
              type="number"
              value={profile.lthr ?? ''}
              onChange={e => update('lthr', e.target.value ? Number(e.target.value) : null)}
              className="w-full bg-raised border border-line-strong rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent"
              placeholder={profile.max_hr ? String(Math.round(profile.max_hr * 0.9)) : '173'}
              step={1}
              min={80}
              max={220}
            />
            <p className="text-micro text-ink-4 mt-0.5">
              {profile.lthr
                ? `Used for HR-based TSS (HRSS) on non-power activities`
                : profile.max_hr
                  ? `Defaults to 90% of max HR (${Math.round(profile.max_hr * 0.9)})`
                  : 'Set Max HR first, or enter directly'}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-micro text-ink-4 uppercase tracking-wider mb-1">Rider Weight (kg)</label>
            <input
              type="number"
              value={profile.weight_kg ?? ''}
              onChange={e => update('weight_kg', e.target.value ? Number(e.target.value) : null)}
              className="w-full bg-raised border border-line-strong rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent"
              placeholder="75"
              step={0.5}
              min={40}
              max={150}
            />
          </div>
          <div>
            <label className="block text-micro text-ink-4 uppercase tracking-wider mb-1">Bike Weight (kg)</label>
            <input
              type="number"
              value={profile.bike_weight_kg ?? ''}
              onChange={e => update('bike_weight_kg', e.target.value ? Number(e.target.value) : null)}
              className="w-full bg-raised border border-line-strong rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent"
              placeholder="8"
              step={0.5}
              min={3}
              max={20}
            />
          </div>
        </div>
      </div>

      {/* Training Plans */}
      <TrainingPlansSettings />

      </>)}
      {tab === 'connections' && (<>
      {/* Data sources — exactly one provider writes activities */}
      <div className="bg-surface rounded-xl p-5 space-y-4 border border-line">
        <div>
          <h2 className="text-sm font-semibold text-ink-2 uppercase tracking-wider">Data Sources</h2>
          <p className="text-xs text-ink-4 mt-1">
            One provider supplies activities at a time. Running both would let the same
            ride land twice and double-count TSS, which skews Fitness &amp; Freshness.
          </p>
        </div>

        <div className="space-y-2">
          {([
            { id: 'garmin', label: 'Garmin', ready: true,
              hint: 'Direct from Garmin Connect. Device-measured power and native wellness.' },
            { id: 'strava', label: 'Strava', ready: true,
              hint: 'Real-time webhook. Switch back here if Garmin stops syncing.' },
          ] as const).map(opt => {
            const active = (profile?.primary_source ?? 'strava') === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={async () => { await updateAndSave('primary_source', opt.id); }}
                disabled={saving || !opt.ready}
                aria-pressed={active}
                title={opt.ready ? undefined : 'Garmin activity sync is not built yet'}
                className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                  active
                    ? 'bg-accent/15 border-accent text-ink'
                    : 'bg-raised border-line-strong text-ink-2 hover:border-line-hover'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{opt.label}</span>
                  {active && <span className="text-micro uppercase tracking-wider text-accent-hi">Active</span>}
                  {!opt.ready && <span className="text-micro uppercase tracking-wider text-ink-4">Coming soon</span>}
                </div>
                <p className="text-xs text-ink-4 mt-0.5">{opt.hint}</p>
              </button>
            );
          })}
        </div>

        {/* Liveness. With no redundancy behind the active source, a stalled
            sync must be visible rather than inferred from missing rides. */}
        {health && (
          <div className="border-t border-line pt-3 space-y-1.5">
            {health.garmin?.status === 'reauth_required' && (
              <p className="text-xs text-red-400">
                Garmin needs re-authentication — run <code className="font-mono">npm run garmin:login</code>.
              </p>
            )}
            {health.providers.map(p => (
              <div key={p.provider} className="flex items-center gap-2 text-xs">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    p.lastError ? 'bg-red-500' : p.stale ? 'bg-amber-500' : 'bg-green-500'
                  }`}
                />
                <span className="text-ink-3 capitalize w-20">{p.provider}</span>
                <span className="text-ink-4">{sinceLabel(p.lastOkAt)}</span>
                {p.detail && <span className="text-ink-5 truncate">· {p.detail}</span>}
                {p.lastError && <span className="text-red-400 truncate">· {p.lastError}</span>}
              </div>
            ))}
          </div>
        )}

        <p className="text-mini text-ink-4 border-t border-line pt-3">
          Switching only changes which provider <em>writes</em> activities. Your Strava
          login keeps working either way, and nothing already imported is removed.
        </p>

        {/* intervals.icu is wellness-only, so it's independent of the choice above */}
        <label className="flex items-start gap-3 border-t border-line pt-4 cursor-pointer">
          <input
            type="checkbox"
            checked={profile?.intervals_wellness_enabled !== false}
            onChange={async e => { await updateAndSave('intervals_wellness_enabled', e.target.checked); }}
            disabled={saving}
            className="mt-0.5 w-4 h-4 accent-accent"
          />
          <span>
            <span className="text-sm text-ink-2">Use intervals.icu for wellness</span>
            <span className="block text-xs text-ink-4 mt-0.5">
              HRV, sleep and readiness, plus power-meter device names. Supplies no
              activities, so this is independent of the source above.
            </span>
          </span>
        </label>
      </div>

      {/* Strava Connection */}
      <div className="bg-surface rounded-xl p-5 space-y-4 border border-line">
        <div>
          <h2 className="text-sm font-semibold text-ink-2 uppercase tracking-wider">Strava Connection</h2>
          <p className="text-xs text-ink-4 mt-1">
            Re-authorise to grant access to routes and segments. Required to load Strava courses on event pages.
          </p>
        </div>
        <a
          href="/api/strava/auth"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent hover:bg-accent text-ink text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
          </svg>
          Reconnect Strava
        </a>

        {/* Activity history import */}
        <div className="border-t border-line pt-4 space-y-3">
          <div>
            <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wider">Import Activity History</h3>
            <p className="text-xs text-ink-4 mt-1">
              Pull in older activities from Strava that aren&apos;t yet in the database.
              Imports up to 1 000 activities per press, oldest first.
            </p>
          </div>

          {/* Status strip */}
          {historyLoading ? (
            <p className="text-xs text-ink-5">Loading…</p>
          ) : historyStatus ? (
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-raised rounded-lg p-2.5 text-center">
                <p className="text-micro text-ink-4 uppercase tracking-wider">Stored</p>
                <p className="text-base font-bold text-ink mt-0.5">{historyStatus.total.toLocaleString()}</p>
              </div>
              <div className="bg-raised rounded-lg p-2.5 text-center">
                <p className="text-micro text-ink-4 uppercase tracking-wider">Newest</p>
                <p className="text-mini font-semibold text-ink mt-0.5">{fmtDate(historyStatus.newestDate)}</p>
              </div>
              <div className="bg-raised rounded-lg p-2.5 text-center">
                <p className="text-micro text-ink-4 uppercase tracking-wider">Oldest</p>
                <p className="text-mini font-semibold text-ink mt-0.5">{fmtDate(historyStatus.oldestDate)}</p>
              </div>
            </div>
          ) : null}

          <button
            onClick={runHistoryImport}
            disabled={historyBusy}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-hover hover:bg-hover-2 disabled:opacity-50 text-ink text-sm font-medium transition-colors"
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
            <div className="bg-page rounded-lg p-3 space-y-1 max-h-32 overflow-y-auto">
              {historyLog.map((line, i) => (
                <p key={i} className="text-mini text-ink-3 font-mono">{line}</p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* intervals.icu Integration */}
      <div className="bg-surface rounded-xl p-5 space-y-4 border border-line">
        <div>
          <h2 className="text-sm font-semibold text-ink-2 uppercase tracking-wider">intervals.icu</h2>
          <p className="text-xs text-ink-4 mt-1">
            Sync daily HRV, readiness score, and sleep score to power the Readiness dashboard.
            Find your Athlete ID in your intervals.icu URL: <span className="text-ink-3 font-mono">intervals.icu/athlete/</span><span className="text-accent-hi font-mono">i12345</span>.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-micro text-ink-4 uppercase tracking-wider mb-1">Athlete ID</label>
            <input
              type="text"
              value={intervalsCreds.id}
              onChange={e => setIntervalsCreds(c => ({ ...c, id: e.target.value }))}
              className="w-full bg-raised border border-line-strong rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent font-mono"
              placeholder="i12345"
            />
          </div>
          <div>
            <label className="block text-micro text-ink-4 uppercase tracking-wider mb-1">API Key</label>
            <input
              type="password"
              value={intervalsCreds.key}
              onChange={e => setIntervalsCreds(c => ({ ...c, key: e.target.value }))}
              className="w-full bg-raised border border-line-strong rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent font-mono"
              placeholder={profile?.intervals_api_key_set ? '•••••••• (saved)' : '••••••••••••••••'}
            />
            <p className="text-micro text-ink-4 mt-1">
              {profile?.intervals_api_key_set
                ? 'A key is saved. Leave blank to keep it, or type a new one to replace it.'
                : 'No key saved yet.'}
            </p>
          </div>
        </div>

        {/* Wellness DB status */}
        {!wellnessLoading && wellnessStatus && wellnessStatus.total > 0 && (
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-raised rounded-lg p-2.5 text-center">
              <p className="text-micro text-ink-4 uppercase tracking-wider">Stored</p>
              <p className="text-base font-bold text-ink mt-0.5">{wellnessStatus.total.toLocaleString()}</p>
            </div>
            <div className="bg-raised rounded-lg p-2.5 text-center">
              <p className="text-micro text-ink-4 uppercase tracking-wider">Newest</p>
              <p className="text-mini font-semibold text-ink mt-0.5">{fmtDate(wellnessStatus.newestDate)}</p>
            </div>
            <div className="bg-raised rounded-lg p-2.5 text-center">
              <p className="text-micro text-ink-4 uppercase tracking-wider">Oldest</p>
              <p className="text-mini font-semibold text-ink mt-0.5">{fmtDate(wellnessStatus.oldestDate)}</p>
            </div>
          </div>
        )}

        {/* Sync buttons */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => runWellnessSync(90)}
            disabled={wellnessBusy || !intervalsCreds.id || !(intervalsCreds.key || profile?.intervals_api_key_set)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-hover hover:bg-hover-2 disabled:opacity-50 text-ink text-sm font-medium transition-colors"
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
            disabled={wellnessBusy || !intervalsCreds.id || !(intervalsCreds.key || profile?.intervals_api_key_set)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-raised hover:bg-hover disabled:opacity-50 text-ink-2 text-sm font-medium transition-colors border border-line-strong"
          >
            Backfill 1 year
          </button>
          <button
            onClick={saveIntervalsCreds}
            disabled={saving || !intervalsCreds.id || !(intervalsCreds.key || profile?.intervals_api_key_set)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent/10 hover:bg-accent/20 disabled:opacity-50 text-accent-hi text-sm font-medium transition-colors border border-accent/30"
          >
            Save credentials
          </button>
        </div>

        {/* Sync log */}
        {wellnessLog.length > 0 && (
          <div className="bg-page rounded-lg p-3 space-y-1">
            {wellnessLog.map((line, i) => (
              <p key={i} className="text-mini text-ink-3 font-mono">{line}</p>
            ))}
          </div>
        )}
      </div>

      </>)}
      {tab === 'data' && (<>
      {/* Activity Sync */}
      <div className="bg-surface rounded-xl p-5 space-y-4 border border-line">
        <div>
          <h2 className="text-sm font-semibold text-ink-2 uppercase tracking-wider">Activity Sync</h2>
          <p className="text-xs text-ink-4 mt-1">
            Sync recent activities from Strava and update power meter data from intervals.icu.
          </p>
        </div>

        {/* Strava recent sync */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wider">Strava Recent Sync</h3>
          <p className="text-xs text-ink-4">Pull in new activities from the past few weeks.</p>
          <button
            onClick={runStravaSync}
            disabled={stravaSyncing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-hover hover:bg-hover-2 disabled:opacity-50 text-ink text-sm font-medium transition-colors"
          >
            {stravaSyncing ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" strokeOpacity={0.25} />
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
                Syncing…
              </>
            ) : 'Sync from Strava'}
          </button>
          {stravaSyncLog.length > 0 && (
            <div className="bg-page rounded-lg p-3 space-y-1">
              {stravaSyncLog.map((line, i) => (
                <p key={i} className="text-mini text-ink-3 font-mono">{line}</p>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-line" />

        {/* Power meter backfill */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wider">Power Meter Data</h3>
          <p className="text-xs text-ink-4">Backfill power meter device names from intervals.icu across all activities.</p>
          <button
            onClick={runPmBackfill}
            disabled={pmSyncing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-hover hover:bg-hover-2 disabled:opacity-50 text-ink text-sm font-medium transition-colors"
          >
            {pmSyncing ? (
              <>
                <svg className="w-4 h-4 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Syncing…
              </>
            ) : 'Sync power meter data'}
          </button>
          {pmSyncLog.length > 0 && (
            <div className="bg-page rounded-lg p-3 space-y-1">
              {pmSyncLog.map((line, i) => (
                <p key={i} className="text-mini text-ink-3 font-mono">{line}</p>
              ))}
            </div>
          )}
        </div>
      </div>

      </>)}
      <div className="flex justify-between items-center">
        <button
          onClick={async () => {
            await fetch('/api/auth/logout', { method: 'POST' });
            window.location.href = '/login';
          }}
          className="px-4 py-2.5 rounded-lg bg-raised hover:bg-hover text-ink-3 hover:text-ink text-sm font-medium transition-colors border border-line-strong"
        >
          Sign out
        </button>
        <div className="flex items-center gap-3">
          <SaveStatus error={error} onRetry={() => save()} />
          <button onClick={() => save()} disabled={saving} className="px-6 py-2.5 rounded-lg bg-accent hover:bg-accent-hi disabled:opacity-50 text-ink text-sm font-medium transition-colors">
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save settings'}
          </button>
        </div>
      </div>
    </PageShell>
  );
}
