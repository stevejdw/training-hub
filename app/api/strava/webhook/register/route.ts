/**
 * One-time webhook registration with Strava.
 *
 * GET  /api/strava/webhook/register          — check existing + register if none
 * DELETE /api/strava/webhook/register?id=123 — remove a subscription
 *
 * Strava will call GET /api/strava/webhook to verify the callback URL
 * before confirming the subscription.
 */
export const runtime = 'nodejs';

const CLIENT_ID     = process.env.STRAVA_CLIENT_ID!.trim();
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET!.trim();
const VERIFY_TOKEN  = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN ?? 'training-hub-strava';

function appUrl(req: Request): string {
  const url = new URL(req.url);
  const override = url.searchParams.get('app_url');
  if (override) return override.replace(/\/$/, '');
  // Vercel sets VERCEL_PROJECT_PRODUCTION_URL on production deployments
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  // Fall back to same origin
  return `${url.protocol}//${url.host}`;
}

export async function GET(req: Request) {
  // Check for existing subscription
  const checkRes = await fetch(
    `https://www.strava.com/api/v3/push_subscriptions?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`
  );
  const existing = await checkRes.json() as unknown[];

  if (Array.isArray(existing) && existing.length > 0) {
    return Response.json({
      status: 'already_registered',
      subscriptions: existing,
      message: 'Webhook already registered with Strava. New activities will sync automatically.',
    });
  }

  // Register new subscription
  const callbackUrl = `${appUrl(req)}/api/strava/webhook`;

  const regRes = await fetch('https://www.strava.com/api/v3/push_subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:    CLIENT_ID,
      client_secret: CLIENT_SECRET,
      callback_url: callbackUrl,
      verify_token: VERIFY_TOKEN,
    }),
  });

  const data = await regRes.json();

  if (!regRes.ok) {
    return Response.json({ status: 'error', httpStatus: regRes.status, data, callbackUrl }, { status: 500 });
  }

  return Response.json({
    status: 'registered',
    data,
    callbackUrl,
    message: 'Webhook registered. Strava will now push new activities instantly.',
  });
}

// DELETE /api/strava/webhook/register?id=<subscription_id>
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id  = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id param required' }, { status: 400 });

  const res = await fetch(
    `https://www.strava.com/api/v3/push_subscriptions/${id}?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`,
    { method: 'DELETE' }
  );

  return Response.json({ ok: res.ok, status: res.status });
}
