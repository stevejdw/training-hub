import { destroySessionCookie } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST() {
  const cookie = destroySessionCookie();
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie },
  });
}
