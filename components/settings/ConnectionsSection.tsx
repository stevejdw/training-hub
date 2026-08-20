'use client';

import { useEffect, useState } from 'react';
import type { AthleteProfile } from '@/lib/profile';
import type { SettingsCtx } from './types';
import { ActionButton, Group, Log, Row, StatTriptych, inputCls } from './ui';

export interface SyncHealth {
  primary: string;
  intervalsWellness: boolean;
  providers: { provider: string; lastOkAt: string | null; lastError: string | null; detail: string | null; stale: boolean }[];
  garmin?: { connected: boolean; status: string; lastOkAt: string | null; lastError: string | null } | null;
}

interface WellnessStatus {
  total: number;
  oldestDate: string | null;
  newestDate: string | null;
}

export function sinceLabel(iso: string | null): string {
  if (!iso) return 'never';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Active source plus how fresh it is — the one thing worth knowing at a
 *  glance, so the hub row carries it. */
export function connectionsSummary(profile: AthleteProfile, health: SyncHealth | null): string {
  const source = (profile.primary_source ?? 'strava') === 'garmin' ? 'Garmin' : 'Strava';
  const p = health?.providers.find(x => x.provider === (profile.primary_source ?? 'strava'));
  if (!p) return source;
  if (p.lastError) return `${source} · error`;
  return `${source} · ${sinceLabel(p.lastOkAt)}`;
}

const SOURCES = [
  { id: 'garmin', label: 'Garmin', hint: 'Direct from Garmin Connect. Device-measured power and native wellness.' },
  { id: 'strava', label: 'Strava', hint: 'Real-time webhook. Switch back here if Garmin stops syncing.' },
] as const;

export default function ConnectionsSection({ ctx, health }: { ctx: SettingsCtx; health: SyncHealth | null }) {
  const { profile, update, updateAndSave, save, saving } = ctx;

  const [creds, setCreds]       = useState({ id: '', key: '' });
  const [status, setStatus]     = useState<WellnessStatus | null>(null);
  const [busy, setBusy]         = useState(false);
  const [log, setLog]           = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/intervals/sync')
      .then(r => r.json())
      .then((d: WellnessStatus) => setStatus(d))
      .catch(() => {});
  }, []);

  // Pre-fill the athlete ID from the profile. The API key is never sent to the
  // browser — a blank field means "leave the stored key alone".
  useEffect(() => {
    setCreds({ id: profile.intervals_athlete_id ?? '', key: '' });
  }, [profile.intervals_athlete_id]);

  const credsReady = Boolean(creds.id && (creds.key || profile.intervals_api_key_set));

  async function saveCreds() {
    update('intervals_athlete_id', creds.id.trim());
    if (creds.key.trim()) update('intervals_api_key', creds.key.trim());
    await save();
  }

  async function runWellnessSync(days: number) {
    if (busy) return;
    if (creds.id.trim() !== (profile.intervals_athlete_id ?? '') || creds.key.trim()) {
      await saveCreds();
    }
    setBusy(true);
    setLog([]);
    try {
      const res  = await fetch('/api/intervals/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      });
      const data = await res.json() as { synced?: number; oldestDate?: string; newestDate?: string; error?: string };
      if (data.error) {
        setLog([`Error: ${data.error}`]);
      } else {
        setLog([
          `Synced ${data.synced ?? 0} records` +
          (data.oldestDate ? ` (${fmtDate(data.oldestDate)} – ${fmtDate(data.newestDate ?? null)})` : ''),
        ]);
        setStatus(await fetch('/api/intervals/sync').then(r => r.json()) as WellnessStatus);
      }
    } catch (err) {
      setLog([`Failed: ${String(err)}`]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Group
        title="Activity source"
        footer="One provider writes activities at a time — running both would land the same ride twice and double-count TSS. Switching doesn't remove anything already imported."
      >
        {SOURCES.map(opt => {
          const active = (profile.primary_source ?? 'strava') === opt.id;
          const p = health?.providers.find(x => x.provider === opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => { void updateAndSave('primary_source', opt.id); }}
              disabled={saving}
              aria-pressed={active}
              className={`w-full px-4 py-3.5 text-left transition-colors disabled:opacity-50 ${active ? 'bg-accent/10' : 'hover:bg-raised/40'}`}
            >
              <div className="flex items-center gap-2">
                <span className={`text-sm font-medium ${active ? 'text-accent-hi' : 'text-ink-2'}`}>{opt.label}</span>
                {active && <span className="text-micro uppercase tracking-wider text-accent-hi">Active</span>}
                {p && (
                  <span className="ml-auto flex items-center gap-1.5 text-micro text-ink-4">
                    <span className={`h-1.5 w-1.5 rounded-full ${p.lastError ? 'bg-red-500' : p.stale ? 'bg-amber-500' : 'bg-green-500'}`} />
                    {p.lastError ? 'error' : sinceLabel(p.lastOkAt)}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-ink-4">{p?.lastError ?? opt.hint}</p>
            </button>
          );
        })}
        {health?.garmin?.status === 'reauth_required' && (
          <Row>
            <p className="text-xs text-red-400">
              Garmin needs re-authentication — run <code className="font-mono">npm run garmin:login</code>.
            </p>
          </Row>
        )}
      </Group>

      <Group title="Strava" footer="Re-authorise to grant access to routes and segments — required to load Strava courses on event pages.">
        <Row>
          <a
            href="/api/strava/auth"
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-ink transition-colors"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
            </svg>
            Reconnect Strava
          </a>
        </Row>
      </Group>

      <Group
        title="intervals.icu"
        footer={
          <>
            Supplies HRV, sleep and readiness — no activities, so it&apos;s independent of the source above.
            Your athlete ID is the <span className="font-mono text-ink-3">i12345</span> in your intervals.icu URL.
          </>
        }
      >
        <label className="flex cursor-pointer items-start gap-3 px-4 py-3.5">
          <input
            type="checkbox"
            checked={profile.intervals_wellness_enabled !== false}
            onChange={e => { void updateAndSave('intervals_wellness_enabled', e.target.checked); }}
            disabled={saving}
            className="mt-0.5 h-4 w-4 accent-accent"
          />
          <span className="text-sm text-ink-2">Use intervals.icu for wellness</span>
        </label>

        <div className="grid gap-3 px-4 py-3.5 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-micro uppercase tracking-wider text-ink-4">Athlete ID</label>
            <input
              type="text"
              value={creds.id}
              onChange={e => setCreds(c => ({ ...c, id: e.target.value }))}
              className={`${inputCls} font-mono`}
              placeholder="i12345"
            />
          </div>
          <div>
            <label className="mb-1 block text-micro uppercase tracking-wider text-ink-4">API key</label>
            <input
              type="password"
              value={creds.key}
              onChange={e => setCreds(c => ({ ...c, key: e.target.value }))}
              className={`${inputCls} font-mono`}
              placeholder={profile.intervals_api_key_set ? '•••••••• (saved)' : '••••••••••••••••'}
            />
            <p className="mt-1 text-micro text-ink-4">
              {profile.intervals_api_key_set
                ? 'Leave blank to keep the saved key.'
                : 'No key saved yet.'}
            </p>
          </div>
        </div>

        <div className="space-y-3 px-4 py-3.5">
          {status && status.total > 0 && (
            <StatTriptych
              stats={[
                { label: 'Stored', value: status.total.toLocaleString() },
                { label: 'Newest', value: fmtDate(status.newestDate) },
                { label: 'Oldest', value: fmtDate(status.oldestDate) },
              ]}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <ActionButton onClick={() => void runWellnessSync(90)} busy={busy} busyLabel="Syncing…" disabled={!credsReady}>
              Sync last 90 days
            </ActionButton>
            <ActionButton onClick={() => void runWellnessSync(365)} busy={busy} busyLabel="Syncing…" disabled={!credsReady}>
              Backfill 1 year
            </ActionButton>
            <ActionButton onClick={() => void saveCreds()} disabled={saving || !credsReady} variant="accent">
              Save credentials
            </ActionButton>
          </div>
          <Log lines={log} />
        </div>
      </Group>
    </>
  );
}
