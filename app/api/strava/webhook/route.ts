import { after } from 'next/server';
import { syncActivity } from '@/lib/strava-sync';
import { syncPowerMeters } from '@/lib/power-meter-sync';

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
        await syncActivity(body.object_id);
        console.log(`Webhook: synced activity ${body.object_id} (${body.aspect_type})`);
        // Sync power meter data for the last 3 days — covers the new activity
        const newest = new Date().toISOString().split('T')[0];
        const oldest = new Date(Date.now() - 3 * 86400_000).toISOString().split('T')[0];
        await syncPowerMeters(oldest, newest).catch(() => {});
      }
    } catch (err) {
      console.error('Webhook sync error:', err);
    }
  });

  return new Response('EVENT_RECEIVED', { status: 200 });
}
