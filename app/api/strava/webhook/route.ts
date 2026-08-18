import { after } from 'next/server';
import { syncActivity } from '@/lib/strava-sync';
import { syncPowerMeters } from '@/lib/power-meter-sync';
import { getSyncSources } from '@/lib/sync-sources';
import { dispatchGarminSync } from '@/lib/github-dispatch';

export const runtime = 'nodejs';

const VERIFY_TOKEN = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN ?? 'training-hub-strava';

// Strava sends a GET to verify the endpoint when you register the webhook
export async function GET(req: Request) {
  const url    = new URL(req.url);
  const mode   = url.searchParams.get('hub.mode');
  const token  = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === VERIFY_TOKEN && challenge) {
    return Response.json({ 'hub.challenge': challenge });
  }
  return new Response('Forbidden', { status: 403 });
}

// Strava POSTs here whenever an activity is created/updated
export async function POST(req: Request) {
  const body = await req.json() as {
    object_type: string;
    aspect_type: string;
    object_id:   number;
    owner_id:    number;
  };

  // Respond immediately — Strava requires a reply within 2 seconds
  after(async () => {
    try {
      if (body.object_type === 'activity' && (body.aspect_type === 'create' || body.aspect_type === 'update')) {
        // Only one provider writes activities at a time, so that a ride can
        // never land twice and double-count TSS. We still ACK the webhook
        // above (Strava disables subscriptions that stop responding), we just
        // don't write. Note this gates ingest only — Strava OAuth login is
        // deliberately never checked against this.
        const { primary, intervalsWellness } = await getSyncSources();
        if (primary !== 'strava') {
          // Strava is only the doorbell here. Garmin has no webhook of its own,
          // but it auto-syncs to Strava — so this notification means the ride
          // exists on Garmin too, and we can pull it now rather than waiting
          // for the next scheduled poll.
          const r = await dispatchGarminSync({
            reason:      'strava-webhook',
            strava_id:   body.object_id,
            aspect_type: body.aspect_type,
          });
          console.log(
            r.ok
              ? `Webhook: triggered Garmin sync for Strava activity ${body.object_id}`
              : `Webhook: could not trigger Garmin sync (${r.reason}) — the scheduled poll will catch it`
          );
          return;
        }
        await syncActivity(body.object_id);
        console.log(`Webhook: synced activity ${body.object_id} (${body.aspect_type})`);
        // Sync power meter data for the last 3 days — covers the new activity
        if (intervalsWellness) {
          const newest = new Date().toISOString().split('T')[0];
          const oldest = new Date(Date.now() - 3 * 86400_000).toISOString().split('T')[0];
          await syncPowerMeters(oldest, newest).catch(() => {});
        }
      }
    } catch (err) {
      console.error('Webhook sync error:', err);
    }
  });

  return new Response('EVENT_RECEIVED', { status: 200 });
}
