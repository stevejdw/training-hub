'use client';

import { useState } from 'react';
import { type ThemePreference, setThemePreference, useThemePreference } from '@/components/ThemeProvider';
import { APP_ICONS, type AppIconId, isNativeApp, setNativeAppIcon } from '@/lib/native-app-icon';
import { CHART } from '@/lib/chart-theme';
import type { SettingsCtx } from './types';
import { Group } from './ui';

export const THEME_FAMILIES = [
  {
    name: 'Carbon',
    dark:  { id: 'dark'        as const, bg: '#030712', card: '#111827', accent: '#f97316' },
    light: { id: 'light'       as const, bg: '#f8fafc', card: '#ffffff', accent: '#f97316' },
  },
  {
    name: 'Ocean',
    dark:  { id: 'ocean'       as const, bg: '#000d1a', card: '#00172e', accent: '#0ea5e9' },
    light: { id: 'ocean-light' as const, bg: '#f0f9ff', card: '#ffffff', accent: '#0ea5e9' },
  },
  {
    name: 'Sand',
    dark:  { id: 'sand-dark'   as const, bg: '#1a100a', card: '#261510', accent: '#0ea5e9' },
    light: { id: 'sand'        as const, bg: '#f8f4ef', card: '#ffffff', accent: '#0369a1' },
  },
];

/** Human-readable name for the active theme, for the hub row. */
export function themeLabel(pref: ThemePreference): string {
  if (pref === 'auto') return 'Auto';
  for (const f of THEME_FAMILIES) {
    if (f.dark.id === pref)  return `${f.name} dark`;
    if (f.light.id === pref) return `${f.name} light`;
  }
  return 'Carbon dark';
}

export default function AppearanceSection({ ctx }: { ctx: SettingsCtx }) {
  const { profile, updateAndSave } = ctx;
  const theme = useThemePreference();
  /* Lazy initialiser rather than an effect: this screen is only ever mounted
     from a tap on the Settings hub, never during SSR or hydration. */
  const [native] = useState(() => isNativeApp());
  const [iconNote, setIconNote] = useState<string | null>(null);


  async function chooseIcon(id: AppIconId) {
    setIconNote(null);
    // Persist first: this drives the in-app logo and the web manifest whether
    // or not the native swap succeeds.
    await updateAndSave('app_icon', id);
    const res = await setNativeAppIcon(id);
    if (res.applied) return;

    switch (res.reason) {
      case 'stale-build':
        setIconNote(
          'The installed app is an older build that does not include icon ' +
            'switching yet. Install the latest TestFlight build — the rest of ' +
            'the app updates over the air, but this part ships in the binary.',
        );
        break;
      case 'unsupported':
        setIconNote('This device does not allow changing the app icon.');
        break;
      case 'browser':
        setIconNote(
          native
            ? 'This device does not allow changing the app icon.'
            : 'Home-screen icon changes apply in the installed app. In a browser this only changes the icon shown inside the app.',
        );
        break;
      default:
        setIconNote(res.detail ?? 'Could not change the app icon.');
    }
  }

  const activeIcon = (profile.app_icon ?? 'speed') as AppIconId;

  return (
    <>
      <Group title="Theme">
        <div className="space-y-2 p-3">
          {THEME_FAMILIES.map(family => {
            const anyActive = theme === family.dark.id || theme === family.light.id;
            return (
              <div
                key={family.name}
                className={`overflow-hidden rounded-xl border-2 transition-colors ${anyActive ? 'border-accent' : 'border-line-strong'}`}
              >
                <div className="px-3 pb-1 pt-2.5 text-micro font-semibold uppercase tracking-wider text-ink-4">
                  {family.name}
                </div>
                <div className="grid grid-cols-2">
                  {[
                    { variant: family.dark,  label: 'Dark',  first: true  },
                    { variant: family.light, label: 'Light', first: false },
                  ].map(({ variant, label, first }) => {
                    const isActive = theme === variant.id;
                    return (
                      <button
                        key={variant.id}
                        onClick={() => setThemePreference(variant.id)}
                        className={`border-t border-line-strong p-3 text-left transition-colors ${first ? 'border-r border-line-strong' : ''} ${isActive ? 'bg-accent/10' : 'hover:bg-raised'}`}
                      >
                        <div className="mb-2 flex gap-1.5">
                          <div className="h-4 w-4 rounded" style={{ background: variant.bg }} />
                          <div
                            className="h-4 w-4 rounded"
                            style={{ background: variant.card, border: variant.card === CHART.tooltipText ? '1px solid #d1d5db' : undefined }}
                          />
                          <div className="h-4 w-4 rounded" style={{ background: variant.accent }} />
                        </div>
                        <p className={`text-xs font-semibold ${isActive ? 'text-accent-hi' : 'text-ink-2'}`}>{label}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <button
            onClick={() => setThemePreference('auto')}
            className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 transition-colors ${theme === 'auto' ? 'border-accent bg-accent/10' : 'border-line-strong hover:border-line-hover'}`}
          >
            <div className="text-left">
              <p className={`text-xs font-semibold ${theme === 'auto' ? 'text-accent-hi' : 'text-ink-2'}`}>Auto</p>
              <p className="mt-0.5 text-micro text-ink-4">Carbon dark at night, Carbon light from 7am</p>
            </div>
            <div className="ml-3 flex flex-shrink-0 gap-1">
              <div className="h-4 w-4 rounded" style={{ background: 'linear-gradient(135deg, #030712 50%, #f8fafc 50%)' }} />
              <div className="h-4 w-4 rounded" style={{ background: CHART.power }} />
            </div>
          </button>
        </div>
      </Group>

      <Group
        title="App icon"
        footer={
          iconNote ??
          (native
            ? 'Changes the home-screen icon straight away. iOS shows its own confirmation when it does.'
            : 'Changes the icon inside the app. The home-screen icon follows in the installed app.')
        }
      >
        <div className="grid grid-cols-4 gap-2 p-3">
          {APP_ICONS.map(({ id, label }) => {
            const active = activeIcon === id;
            return (
              <button
                key={id}
                onClick={() => { void chooseIcon(id); }}
                className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-2 transition-colors ${active ? 'border-accent bg-accent/10' : 'border-line-strong hover:border-line-hover'}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/app-icon-${id}.png`} alt={label} className="h-14 w-14 rounded-xl object-cover" />
                <span className={`text-micro font-semibold ${active ? 'text-accent-hi' : 'text-ink-3'}`}>{label}</span>
              </button>
            );
          })}
        </div>
      </Group>
    </>
  );
}
