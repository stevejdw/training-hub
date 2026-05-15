import { timingSafeEqual } from 'crypto';
import pool from '@/lib/db';
import { createSessionCookie } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { password } = await req.json() as { password?: string };

  const APP_PASSWORD = process.env.APP_PASSWORD;
  if (!APP_PASSWORD) {
    return Response.json({ error: 'APP_PASSWORD env var not set' }, { status: 500 });
  }

  // Timing-safe comparison to prevent timing attacks
  const inputBuf    = Buffer.from(password ?? '');
  const expectedBuf = Buffer.from(APP_PASSWORD);
  const match =
    inputBuf.length === expectedBuf.length &&
    timingSafeEqual(inputBuf, expectedBuf);

  if (!match) {
    return Response.json({ error: 'Incorrect password' }, { status: 401 });
  }

  const client = await pool.connect();
  try {
    const res = await client.query<{ id: number; strava_id: string; name: string }>(
      'SELECT id, strava_id, name FROM users LIMIT 1'
    );
    if (res.rows.length === 0) {
      return Response.json(
        { error: 'No account found — connect Strava first via the setup flow' },
        { status: 404 }
      );
    }
    const user = res.rows[0];
    const cookie = await createSessionCookie({
      userId:   user.id,
      stravaId: Number(user.strava_id),
      name:     user.name,
    });
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie },
    });
  } finally {
    client.release();
  }
}
