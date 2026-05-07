import { NextRequest } from 'next/server';
import pool from '@/lib/db';
import { createSessionCookie, destroySessionCookie } from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * GET /api/strava/callback?code=...
 * Called by Strava after the user approves the OAuth request.
 * On first successful auth we store a `users` row and the tokens.
 * On subsequent auths we verify the Strava athlete matches the
 * original user — if not, we deny access.
 */
export async function GET(req: NextRequest) {
  const code  = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');

  if (error) {
    return new Response(
      `<html><body style="font-family:sans-serif;padding:2rem;background:#111;color:#f97316">
        <h2>Strava auth declined</h2>
        <p>${error}</p>
        <a href="/login" style="color:#f97316">← Back to Login</a>
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
    athlete:       { id: number; firstname?: string; lastname?: string };
    scope?:        string;
  };

  const stravaId   = tokens.athlete.id;
  const athleteName = [tokens.athlete.firstname, tokens.athlete.lastname]
    .filter(Boolean).join(' ') || 'Athlete';

  let userId: number = 0;
  const dbClient = await pool.connect();
  try {

    // Ensure tables exist
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS users (
        id         SERIAL PRIMARY KEY,
        strava_id  BIGINT UNIQUE NOT NULL,
        name       TEXT NOT NULL DEFAULT '',
        avatar     TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS strava_tokens (
        id           INTEGER PRIMARY KEY DEFAULT 1,
        access_token  TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at    BIGINT NOT NULL,
        scope         TEXT,
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Add user_id column idempotently (existing tables may not have it yet)
    await dbClient.query(`ALTER TABLE strava_tokens ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`);

    // Look for an existing strava_tokens row with a linked user. If it exists,
    // only that original athlete is authorised. If the row exists but hasn't been
    // linked to a user yet (pre-migration), treat this as a first-time auth.
    const existingTokens = await dbClient.query(
      `SELECT id, user_id FROM strava_tokens LIMIT 1`
    );

    const existingUserId =
      existingTokens.rows.length > 0 ? existingTokens.rows[0].user_id : null;

    if (existingUserId != null) {

      // App has been authorised before — check the athlete matches
      const userRes = await dbClient.query(
        `SELECT id, strava_id FROM users WHERE id = $1`,
        [existingUserId]
      );

      if (userRes.rows.length === 0) {
        // Shouldn't happen due to FK, but handle gracefully
        return new Response(
          `<html><body style="font-family:sans-serif;padding:2rem;background:#111;color:#ef4444">
            <h2>⛔ Setup error</h2>
            <p>User record not found. Please contact the app administrator.</p>
            <a href="/login" style="color:#f97316">← Back</a>
          </body></html>`,
          { headers: { 'Content-Type': 'text/html' } }
        );
      }

      const storedStravaId = userRes.rows[0].strava_id;

      if (Number(storedStravaId) !== stravaId) {
        // Different Strava account — deny access
        return new Response(
          `<html><body style="font-family:sans-serif;padding:2rem;background:#111;color:#ef4444">
            <h2>⛔ Access denied</h2>
            <p>This Strava account is not authorised to use this Training Hub instance.</p>
            <p style="color:#9ca3af;font-size:0.85rem">Only the original Strava account that first connected to this app may log in.</p>
            <a href="/login" style="color:#f97316">← Back to Login</a>
          </body></html>`,
          { headers: { 'Content-Type': 'text/html' } }
        );
      }

      userId = existingUserId;

      // Update tokens for this user
      await dbClient.query(`
        INSERT INTO strava_tokens (id, user_id, access_token, refresh_token, expires_at, scope, updated_at)
        VALUES (1, $1, $2, $3, $4, $5, NOW())
        ON CONFLICT (id) DO UPDATE
          SET user_id       = EXCLUDED.user_id,
              access_token  = EXCLUDED.access_token,
              refresh_token = EXCLUDED.refresh_token,
              expires_at    = EXCLUDED.expires_at,
              scope         = EXCLUDED.scope,
              updated_at    = NOW()
      `, [userId, tokens.access_token, tokens.refresh_token, tokens.expires_at, tokens.scope ?? null]);
    } else {
      // First-time auth — create user and store tokens
      const userInsert = await dbClient.query(`
        INSERT INTO users (strava_id, name)
        VALUES ($1, $2)
        RETURNING id
      `, [stravaId, athleteName]);

      userId = userInsert.rows[0].id;

      await dbClient.query(`
        INSERT INTO strava_tokens (id, user_id, access_token, refresh_token, expires_at, scope, updated_at)
        VALUES (1, $1, $2, $3, $4, $5, NOW())
        ON CONFLICT (id) DO UPDATE
          SET user_id       = EXCLUDED.user_id,
              access_token  = EXCLUDED.access_token,
              refresh_token = EXCLUDED.refresh_token,
              expires_at    = EXCLUDED.expires_at,
              scope         = EXCLUDED.scope,
              updated_at    = NOW()
      `, [userId, tokens.access_token, tokens.refresh_token, tokens.expires_at, tokens.scope ?? null]);

      // Also set an initial athlete_profile row for this user if not exists
      await dbClient.query(`
        INSERT INTO athlete_profile (id, data, updated_at)
        VALUES (1, '${JSON.stringify({ name: athleteName })}'::jsonb, NOW())
        ON CONFLICT (id) DO NOTHING
      `);
    }
  } finally {
    dbClient.release();
  }

  // Create session cookie
  const sessionCookie = await createSessionCookie({
    userId,
    stravaId,
    name: athleteName,
  });


  const scope = tokens.scope ?? '(unknown)';

  // Return HTML that sets the cookie via JS (to work in redirect context)
  // then redirects to the dashboard
  return new Response(
    `<html><body style="font-family:sans-serif;padding:2rem;background:#111;color:#eee">
      <script>
        document.cookie = "${sessionCookie}";
        window.location.href = "/dashboard";
      </script>
      <h2 style="color:#f97316">✓ Connected as ${athleteName}</h2>
      <p style="color:#9ca3af;font-size:0.85rem">Scopes granted: <code style="color:#f97316">${scope}</code></p>
      <p><a href="/dashboard" style="color:#f97316">Continue to dashboard →</a></p>
    </body></html>`,
    {
      headers: {
        'Content-Type': 'text/html',
        'Set-Cookie': sessionCookie,
      },
    }
  );
}
