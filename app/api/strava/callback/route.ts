import { NextRequest } from 'next/server';
import pool from '@/lib/db';

export const runtime = 'nodejs';

/**
 * GET /api/strava/callback?code=...
 * Called by Strava after the user approves the OAuth request.
 * Exchanges the code for access + refresh tokens and stores them in the DB
 * so getStravaToken() can use them without needing env-var changes.
 */
export async function GET(req: NextRequest) {
  const code  = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');

  if (error) {
    return new Response(
      `<html><body style="font-family:sans-serif;padding:2rem;background:#111;color:#f97316">
        <h2>Strava auth declined</h2>
        <p>${error}</p>
        <a href="/settings" style="color:#f97316">← Back to Settings</a>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  }

  if (!code) {
    return Response.json({ error: 'No code returned from Strava' }, { status: 400 });
  }

  const clientId     = process.env.STRAVA_CLIENT_ID!;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET!;

  const tokenRes = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    return Response.json({ error: `Token exchange failed: ${tokenRes.status} ${body}` }, { status: 500 });
  }

  const tokens = await tokenRes.json() as {
    access_token:  string;
    refresh_token: string;
    expires_at:    number;
    athlete?:      { firstname?: string; id?: number };
    scope?:        string;
  };

  // Store in DB — upsert into a simple kv table
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS strava_tokens (
        id           INTEGER PRIMARY KEY DEFAULT 1,
        access_token  TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at    BIGINT NOT NULL,
        scope         TEXT,
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      INSERT INTO strava_tokens (id, access_token, refresh_token, expires_at, scope, updated_at)
      VALUES (1, $1, $2, $3, $4, NOW())
      ON CONFLICT (id) DO UPDATE
        SET access_token  = $1,
            refresh_token = $2,
            expires_at    = $3,
            scope         = $4,
            updated_at    = NOW()
    `, [tokens.access_token, tokens.refresh_token, tokens.expires_at, tokens.scope ?? null]);
  } finally {
    client.release();
  }

  const name  = tokens.athlete?.firstname ?? 'Athlete';
  const scope = tokens.scope ?? '(unknown)';

  return new Response(
    `<html><body style="font-family:sans-serif;padding:2rem;background:#111;color:#eee">
      <h2 style="color:#f97316">✓ Strava connected</h2>
      <p>Hi ${name}! Your new tokens have been saved.</p>
      <p style="color:#9ca3af;font-size:0.85rem">Scopes granted: <code style="color:#f97316">${scope}</code></p>
      <p style="margin-top:1.5rem">
        <a href="/performance" style="color:#f97316;text-decoration:none">← Back to app</a>
      </p>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  );
}
