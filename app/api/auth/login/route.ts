import { timingSafeEqual } from 'crypto';
import pool from '@/lib/db';
import { createSessionCookie } from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * Password login. The only way into the app.
 *
 * Previously this refused with 404 "connect Strava first" whenever the `users`
 * table was empty, which made a third-party OAuth round-trip a prerequisite for
 * signing in to a single-user app — and left no way back in if that row ever
 * went missing. The session no longer depends on a Strava identity: the row is
 * used to populate the display name when it exists, and a local placeholder is
 * created when it doesn't.
 */
export async function POST(req: Request) {
  const { password } = await req.json() as { password?: string };

  // Trimmed for the same reason as the Strava credentials: a value pasted into
  // the Vercel dashboard picks up a trailing space very easily, and here the
  // symptom is an unfixable "Incorrect password" on a password that is right.
  const APP_PASSWORD = process.env.APP_PASSWORD?.trim();
  if (!APP_PASSWORD) {
    return Response.json({ error: 'APP_PASSWORD env var not set' }, { status: 500 });
  }

  // Timing-safe comparison to prevent timing attacks. The submitted value is
  // trimmed too — a mobile keyboard appending a space should not lock you out.
  const inputBuf    = Buffer.from((password ?? '').trim());
  const expectedBuf = Buffer.from(APP_PASSWORD);
  const match =
    inputBuf.length === expectedBuf.length &&
    timingSafeEqual(inputBuf, expectedBuf);

  if (!match) {
    return Response.json({ error: 'Incorrect password' }, { status: 401 });
  }

  // pool.connect() must be inside the try: a DB failure here was escaping as
  // an unhandled HTML 500, which the client could only report as a generic
  // error. It is a 503 with a readable message now.
  let client;
  try {
    client = await pool.connect();
    const res = await client.query<{ id: number; strava_id: string | null; name: string | null }>(
      'SELECT id, strava_id, name FROM users ORDER BY id LIMIT 1'
    );

    let user = res.rows[0];
    if (!user) {
      // No account row yet. Create a local one rather than sending the user to
      // Strava — the password already proved who they are.
      const created = await client.query<{ id: number }>(
        `INSERT INTO users (id, name) VALUES (1, 'Athlete')
         ON CONFLICT (id) DO UPDATE SET name = COALESCE(users.name, 'Athlete')
         RETURNING id`
      );
      user = { id: created.rows[0]?.id ?? 1, strava_id: null, name: 'Athlete' };
    }

    const cookie = await createSessionCookie({
      userId:   user.id,
      stravaId: user.strava_id ? Number(user.strava_id) : null,
      name:     user.name ?? 'Athlete',
    });
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie },
    });
  } catch (err) {
    // A database blip must not look like a wrong password.
    console.error('[auth/login]', err);
    return Response.json(
      { error: `Database unavailable: ${String(err instanceof Error ? err.message : err)}` },
      { status: 503 }
    );
  } finally {
    client?.release();
  }
}
