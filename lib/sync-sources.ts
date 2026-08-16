import { getProfile } from './profile';

/**
 * Which integration is allowed to write training data.
 *
 * Exactly one provider supplies activities at a time. That is a deliberate
 * choice of simplicity over redundancy: running Garmin and Strava together
 * would make duplicate rows possible, and a duplicate ride double-counts TSS,
 * which quietly skews CTL/ATL/TSB and every coaching output derived from them.
 * With a single active source, duplication is impossible by construction
 * rather than by the dedup logic being correct.
 *
 * The cost is that a Garmin outage needs a manual switch back to Strava — the
 * Settings page shows when each source last synced so a stall is visible.
 *
 * IMPORTANT: this governs INGEST ONLY. Strava is also the app's identity
 * provider (app/api/strava/callback/route.ts mints the session cookie), so
 * /api/strava/auth and /api/strava/callback must never consult this — turning
 * Strava's ingest off must not be able to lock the user out.
 *
 * intervals.icu is not an activity source; it supplies wellness (HRV, sleep,
 * readiness) and power-meter device names. It therefore gets an independent
 * on/off rather than competing with the two activity providers.
 */

export type PrimarySource = 'garmin' | 'strava';

export interface SyncSources {
  primary: PrimarySource;
  /** intervals.icu wellness sync + power-meter device attribution. */
  intervalsWellness: boolean;
}

/**
 * Defaults preserve today's behaviour: Strava keeps ingesting and
 * intervals.icu keeps supplying wellness until the user changes it. Deploying
 * this must not silently stop anyone's data.
 */
export const DEFAULT_SOURCES: SyncSources = {
  primary: 'strava',
  intervalsWellness: true,
};

export async function getSyncSources(): Promise<SyncSources> {
  // getProfile() is the cached, geometry-stripped read — safe on hot paths.
  const profile = await getProfile();
  const primary = profile.primary_source === 'garmin' ? 'garmin' : 'strava';
  return {
    primary,
    intervalsWellness: profile.intervals_wellness_enabled !== false,
  };
}

/** True when Strava is allowed to write activities right now. */
export async function stravaIngestEnabled(): Promise<boolean> {
  return (await getSyncSources()).primary === 'strava';
}

/** True when Garmin is allowed to write activities right now. */
export async function garminIngestEnabled(): Promise<boolean> {
  return (await getSyncSources()).primary === 'garmin';
}

/** Human-readable reason for a skipped sync, for logs and API responses. */
export function skippedReason(active: PrimarySource, attempted: string): string {
  return `${attempted} ingest is off — primary source is set to ${active}. ` +
         `Change it in Settings → Data sources.`;
}
