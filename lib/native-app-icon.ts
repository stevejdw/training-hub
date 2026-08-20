'use client';

/** The four selectable icons. `id` matches the `app-icon-<id>.png` files in
 *  /public (used for the in-app logo, the web manifest and the
 *  apple-touch-icon) and the case keys in ios/App/App/AppIconPlugin.swift
 *  (used for the installed app's home-screen icon). Keep all three in step. */
export const APP_ICONS = [
  { id: 'gear',       label: 'Gear'    },
  { id: 'minimalist', label: 'Minimal' },
  { id: 'path',       label: 'Path'    },
  { id: 'speed',      label: 'Speed'   },
] as const;

export type AppIconId = (typeof APP_ICONS)[number]['id'];

interface AppIconPlugin {
  get(): Promise<{ supported: boolean; icon: AppIconId }>;
  set(options: { icon: AppIconId }): Promise<{ icon: AppIconId }>;
}

export function isNativeApp(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
      ?.isNativePlatform?.() === true
  );
}

let cached: AppIconPlugin | null = null;

async function plugin(): Promise<AppIconPlugin | null> {
  if (!isNativeApp()) return null;
  if (cached) return cached;
  try {
    const { registerPlugin } = await import('@capacitor/core');
    cached = registerPlugin<AppIconPlugin>('AppIcon');
    return cached;
  } catch {
    return null;
  }
}

/**
 * Change the home-screen icon of the installed iOS app.
 *
 * Saving `app_icon` on the profile only ever moved the web manifest and the
 * apple-touch-icon, neither of which an installed app reads — its icon is
 * compiled into the asset catalogue. This is the piece that actually changes
 * what you see on the home screen.
 *
 * Returns `applied: false` (not an error) in a plain browser or on a device
 * without alternate-icon support, so callers can still persist the preference
 * for the in-app logo and say something honest about it.
 */
export async function setNativeAppIcon(
  icon: AppIconId,
): Promise<{ applied: boolean; error?: string }> {
  const p = await plugin();
  if (!p) return { applied: false };
  try {
    await p.set({ icon });
    return { applied: true };
  } catch (e) {
    return { applied: false, error: e instanceof Error ? e.message : String(e) };
  }
}
