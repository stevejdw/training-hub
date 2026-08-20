'use client';

import { useEffect, useState } from 'react';
import { useThemePreference } from '@/components/ThemeProvider';
import { iconFor } from '@/components/nav-items';
import AppearanceSection, { themeLabel } from '@/components/settings/AppearanceSection';
import AthleteSection, { athleteSummary } from '@/components/settings/AthleteSection';
import CoachSection, { coachSummary } from '@/components/settings/CoachSection';
import ConnectionsSection, { connectionsSummary, type SyncHealth } from '@/components/settings/ConnectionsSection';
import DataSection from '@/components/settings/DataSection';
import type { SettingsCtx, SettingsSection } from '@/components/settings/types';
import { DrillRow, Group } from '@/components/settings/ui';
import SaveStatus from '@/components/ui/SaveStatus';
import { PageShell, useProfileEdit } from '@/lib/use-profile-edit';

/**
 * Settings.
 *
 * Was one page carrying nine stacked cards behind a five-chip tab strip that
 * didn't fit on a 375px screen, with each card's heading repeating the chip
 * above it and a global "Save settings" button that only some of the controls
 * actually used. Now it's a hub of five rows, each showing its current value,
 * drilling into one screen with one job. Everything saves itself — instantly
 * for taps, on blur for typing — so the only save affordance is the status
 * next to the title.
 */

const gearIcon = (
  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.071 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const SECTION_META: Record<SettingsSection, { label: string; icon: React.ReactNode }> = {
  appearance: {
    label: 'Appearance',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="12" cy="12" r="9" />
        <path strokeLinecap="round" d="M12 3a9 9 0 000 18" fill="currentColor" stroke="none" opacity={0.35} />
      </svg>
    ),
  },
  coach: {
    label: 'Coaching',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
  },
  athlete: {
    label: 'Athlete',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
  connections: {
    label: 'Connections',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5m5.5-1.844a4 4 0 015.656 0 4 4 0 010 5.656l-1.5 1.5" />
      </svg>
    ),
  },
  data: {
    label: 'Data & sync',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M20 9A8 8 0 006.3 5.6L4 9m16 6a8 8 0 01-13.7 3.4L4 15" />
      </svg>
    ),
  },
};

export default function SettingsContent() {
  const [section, setSection] = useState<SettingsSection | null>(null);
  const { profile, update, updateAndSave, save, saving, saved, error } = useProfileEdit();
  const theme = useThemePreference();
  const [health, setHealth] = useState<SyncHealth | null>(null);
  const primarySource = profile?.primary_source;

  // Keyed on whether the profile has arrived, not on the profile object:
  // without the guard this fired once while it was still loading and again
  // when it landed — two identical reads per visit, and egress is the
  // binding constraint on the database.
  const profileLoaded = Boolean(profile);
  useEffect(() => {
    if (!profileLoaded) return;
    fetch('/api/sync/health')
      .then(r => r.json())
      .then((d: SyncHealth) => setHealth(d))
      .catch(() => {});
  }, [profileLoaded, primarySource]);

  if (!profile) {
    return (
      <PageShell title="Settings" icon={iconFor('settings')}>
        <div className="text-sm text-ink-4">Loading…</div>
      </PageShell>
    );
  }

  const ctx: SettingsCtx = { profile, update, updateAndSave, save, saving };
  const status = <SaveStatus saving={saving} saved={saved} error={error} onRetry={() => void save()} />;

  if (section) {
    const meta = SECTION_META[section];
    return (
      <PageShell
        title={meta.label}
        icon={meta.icon}
        right={status}
        back={{ label: 'Settings', onClick: () => setSection(null) }}
        showSettings={false}
      >
        {section === 'appearance'  && <AppearanceSection ctx={ctx} />}
        {section === 'coach'       && <CoachSection ctx={ctx} />}
        {section === 'athlete'     && <AthleteSection ctx={ctx} />}
        {section === 'connections' && <ConnectionsSection ctx={ctx} health={health} />}
        {section === 'data'        && <DataSection />}
      </PageShell>
    );
  }

  const summaries: Record<SettingsSection, string> = {
    appearance:  themeLabel(theme),
    coach:       coachSummary(profile),
    athlete:     athleteSummary(profile),
    connections: connectionsSummary(profile, health),
    data:        '',
  };

  return (
    <PageShell title="Settings" icon={gearIcon} right={status} showSettings={false}>
      <Group>
        {(['appearance', 'coach', 'athlete'] as const).map(key => (
          <DrillRow
            key={key}
            icon={SECTION_META[key].icon}
            label={SECTION_META[key].label}
            value={summaries[key]}
            onClick={() => setSection(key)}
          />
        ))}
      </Group>

      <Group>
        {(['connections', 'data'] as const).map(key => (
          <DrillRow
            key={key}
            icon={SECTION_META[key].icon}
            label={SECTION_META[key].label}
            value={summaries[key]}
            onClick={() => setSection(key)}
          />
        ))}
      </Group>

      <Group>
        <button
          onClick={async () => {
            await fetch('/api/auth/logout', { method: 'POST' });
            window.location.href = '/login';
          }}
          className="w-full px-4 py-3.5 text-left text-base font-medium text-ink-3 transition-colors hover:bg-raised/40 hover:text-ink"
        >
          Sign out
        </button>
      </Group>
    </PageShell>
  );
}
