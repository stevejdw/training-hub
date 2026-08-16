import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

/**
 * GET /api/strava/auth
 * Redirects the browser to Strava's OAuth page requesting all required scopes.
 * After approval Strava redirects to /api/strava/callback which stores the tokens.
 */
export async function GET(req: NextRequest) {
  // Trim: a stray trailing space in the env var makes Strava fail to resolve
  // the application at all, and it reports that as an invalid redirect_url —
  // which sends you looking at the callback domain instead of the client id.
  const clientId   = process.env.STRAVA_CLIENT_ID?.trim();
  if (!clientId) {
    return Response.json({ error: 'STRAVA_CLIENT_ID env var not set' }, { status: 500 });
  }

  // Prefer an explicit env var so the redirect URI is stable across
  // preview deployments and matches what's registered in the Strava app.
  const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : req.nextUrl.origin);
  const redirectUri = `${origin}/api/strava/callback`;

  const url = new URL('https://www.strava.com/oauth/authorize');
  url.searchParams.set('client_id',     clientId);
  url.searchParams.set('redirect_uri',  redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('approval_prompt', 'force');    // always show consent screen
  // read + read_all: access public + private routes/segments
  // activity:read_all: access all activities (existing scope)
  url.searchParams.set('scope', 'read,read_all,activity:read_all,profile:read_all');

  return Response.redirect(url.toString());
}
