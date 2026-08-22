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
export type IconFailure =
  /** Running in a plain browser, not the installed app. */
  | 'browser'
  /** Installed binary predates AppIconPlugin — the web half updates from
   *  Vercel instantly, the native half only ships in a new TestFlight build,
   *  so the two drift apart and the picker appears to do nothing. */
  | 'stale-build'
  /** Device or OS refuses alternate icons. */
  | 'unsupported'
  | 'error';

export interface IconResult {
  applied: boolean;
  reason?: IconFailure;
  detail?: string;
}

/** Capacitor raises this when the JS calls a plugin the installed native
 *  binary does not contain. It is the signature of an out-of-date build, not
 *  of a broken call, and it is worth naming explicitly — otherwise the only
 *  symptom is a picker that silently does nothing. */
function isUnimplemented(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  if (code === 'UNIMPLEMENTED') return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /not implemented|unimplemented/i.test(msg);
}

export async function setNativeAppIcon(icon: AppIconId): Promise<IconResult> {
  const p = await plugin();
  if (!p) return { applied: false, reason: 'browser' };
  try {
    await p.set({ icon });
    return { applied: true };
  } catch (e) {
    if (isUnimplemented(e)) return { applied: false, reason: 'stale-build' };
    const detail = e instanceof Error ? e.message : String(e);
    if (/not supported/i.test(detail)) {
      return { applied: false, reason: 'unsupported', detail };
    }
    return { applied: false, reason: 'error', detail };
  }
}

/** What the installed binary reports about itself. Returns null when the
 *  plugin is absent, which is itself the answer: this build is out of date. */
export async function probeNativeAppIcon(): Promise<
  { supported: boolean; icon: AppIconId } | null
> {
  const p = await plugin();
  if (!p) return null;
  try {
    return await p.get();
  } catch {
    return null;
  }
}
