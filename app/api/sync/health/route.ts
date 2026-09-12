import pool from '@/lib/db';
import { getAccountMeta } from '@/lib/connected-accounts';
import { getSyncSources } from '@/lib/sync-sources';

export const runtime = 'nodejs';

/**
 * Sync health for the Settings page.
 *
 * With exactly one active activity source there is no redundancy absorbing a
 * failure, so a stalled sync has to be visible rather than inferred. This is
 * the whole observability surface — three rows and a status, ~200 bytes.
 *
 * Never returns a credential: the Garmin block is status and timestamps only.
 */

const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export interface SyncHealthRow {
  provider:  string;
  lastOkAt:  string | null;
  lastError: string | null;
  failures:  number;
  detail:    string | null;
  stale:     boolean;
}

/** Providers that report only when something happens, never on a schedule. */
const EVENT_DRIVEN = new Set(['garmin-doorbell']);

export async function GET() {
  const client = await pool.connect();
  try {
    const { primary, intervalsWellness } = await getSyncSources();

    let rows: SyncHealthRow[] = [];
    try {
      const res = await client.query<{
        provider: string; last_ok_at: Date | null; last_error: string | null;
        consecutive_failures: number; detail: string | null;
      }>(`SELECT provider, last_ok_at, last_error, consecutive_failures, detail
            FROM sync_health ORDER BY provider`);
      rows = res.rows.map(r => ({
        provider:  r.provider,
        lastOkAt:  r.last_ok_at ? r.last_ok_at.toISOString() : null,
        lastError: r.last_error,
        failures:  r.consecutive_failures,
        detail:    r.detail,
        // The doorbell is event-driven, not scheduled: it only reports in when
        // a ride finishes, so elapsed time says nothing about its health. Two
        // rest days would light it amber while it was working perfectly.
        // Consecutive failures are the only signal that means anything here.
        stale:     EVENT_DRIVEN.has(r.provider)
          ? r.consecutive_failures > 0
          : !r.last_ok_at || Date.now() - r.last_ok_at.getTime() > STALE_AFTER_MS,
      }));
    } catch {
      // Table not created yet — no sync has reported in.
      rows = [];
    }

    // Strava has no sync_health writer of its own yet; its liveness is simply
    // the most recent activity write, which both the webhook and the cron touch.
    if (!rows.some(r => r.provider === 'strava')) {
      const s = await client.query<{ last: Date | null }>(
        `SELECT GREATEST(MAX(updated_at), MAX(created_at)) AS last FROM activities`
      );
      const last = s.rows[0]?.last ?? null;
      rows.push({
        provider: 'strava', lastOkAt: last ? last.toISOString() : null,
        lastError: null, failures: 0, detail: null,
        stale: !last || Date.now() - last.getTime() > STALE_AFTER_MS,
      });
    }

    const garmin = await getAccountMeta('garmin').catch(() => null);

    return Response.json({
      primary,
      intervalsWellness,
      providers: rows,
      garmin: garmin && {
        connected: true,
        status:    garmin.status,
        lastOkAt:  garmin.lastOkAt,
        lastError: garmin.lastError,
      },
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
