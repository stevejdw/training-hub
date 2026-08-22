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

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
  PluginHeaders?: { name: string }[];
  getPlatform?: () => string;
}

function capacitor(): CapacitorGlobal | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/**
 * Everything the page can learn about the native bridge WITHOUT a dynamic
 * import.
 *
 * The previous diagnostics never reported, because both probes began with
 * `await import(...)`, and an import is a network fetch for a JS chunk. On a
 * stalled connection that hangs forever, so the timeouts guarding the bridge
 * calls downstream never got a chance to fire and nothing was ever sent.
 *
 * Capacitor already publishes its registry on `window` at injection time.
 * Reading it is synchronous and needs no network, so it works precisely when
 * the app is least able to talk to anything — which is when we most need to
 * know what the shell is.
 */
export function inspectBridge(): {
  present: boolean;
  nativePlatform: boolean;
  platform: string | null;
  plugins: string[];
  headers: string[];
  hasAppIcon: boolean;
} {
  const c = capacitor();
  const plugins = c?.Plugins ? Object.keys(c.Plugins).sort() : [];
  const headers = Array.isArray(c?.PluginHeaders)
    ? c.PluginHeaders.map(h => h?.name).filter(Boolean).sort()
    : [];
  return {
    present: !!c,
    nativePlatform: c?.isNativePlatform?.() === true,
    platform: c?.getPlatform?.() ?? null,
    plugins,
    headers,
    hasAppIcon: plugins.includes('AppIcon') || headers.includes('AppIcon'),
  };
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

/** Capacitor answers a call to a plugin the native side does not know about by
 *  simply never answering — the promise neither resolves nor rejects. That is
 *  indistinguishable from a slow call, and it is what left the diagnostics line
 *  reading "checking…" forever. Race every bridge call against a deadline so a
 *  silent bridge reports itself as one. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([
    work,
    new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), ms)),
  ]);
}

export type IconProbe =
  | { state: 'ok'; supported: boolean; icon: AppIconId }
  /** Bridge accepted the call and never answered — plugin missing natively. */
  | { state: 'timeout' }
  /** Not the installed app at all. */
  | { state: 'browser' }
  | { state: 'absent' };

export async function probeNativeAppIcon(): Promise<IconProbe> {
  if (!isNativeApp()) return { state: 'browser' };
  const p = await plugin();
  if (!p) return { state: 'absent' };
  try {
    const r = await withTimeout(p.get(), 3000);
    if (r === 'timeout') return { state: 'timeout' };
    return { state: 'ok', supported: r.supported, icon: r.icon };
  } catch {
    return { state: 'absent' };
  }
}

/** Version and build of the *installed binary*, via @capacitor/app — a plugin
 *  that ships in the npm package and is therefore in packageClassList, so it
 *  works even when an app-target plugin does not. Without this there is no way
 *  to tell which TestFlight build is actually running: the web layer updates
 *  over the air and says nothing about the shell hosting it. */
export async function nativeBuildInfo(): Promise<string | null> {
  if (!isNativeApp()) return null;
  try {
    const { App } = await import('@capacitor/app');
    const r = await withTimeout(App.getInfo(), 3000);
    if (r === 'timeout') return null;
    return `${r.version} (${r.build})`;
  } catch {
    return null;
  }
}
