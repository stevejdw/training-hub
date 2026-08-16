import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? process.env.STRAVA_CLIENT_SECRET ?? 'fallback-dev-secret-do-not-use-in-prod'
);

const COOKIE_NAME = 'session';
const SESSION_DURATION = 60 * 60 * 24 * 30; // 30 days in seconds

export interface SessionUser {
  userId: number;
  /** Null when Strava has never been connected — it's a data source, not the
   *  identity provider, so a session must not depend on having one. */
  stravaId: number | null;
  name: string;
}

/**
 * Create a signed JWT session cookie and return the cookie header string.
 * The cookie is httpOnly, secure, sameSite=lax, path=/.
 */
export async function createSessionCookie(user: SessionUser): Promise<string> {
  const token = await new SignJWT({ ...user })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION}s`)
    .sign(SECRET);

  const maxAge = SESSION_DURATION;
  // Build the cookie manually to avoid depending on Next.js 16 cookie API shape
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; ${
    process.env.NODE_ENV === 'production' ? 'Secure; ' : ''
  }`;
}

/** Destroy the session cookie. */
export function destroySessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; ${
    process.env.NODE_ENV === 'production' ? 'Secure; ' : ''
  }`;
}

/**
 * Read and verify the session cookie from a NextRequest.
 * Returns the session user or null if not authenticated.
 */
export async function getSessionFromRequest(req: NextRequest): Promise<SessionUser | null> {
  const cookie = req.cookies.get(COOKIE_NAME);
  if (!cookie?.value) return null;
  try {
    const { payload } = await jwtVerify(cookie.value, SECRET);
    return payload as unknown as SessionUser;
  } catch {
    return null;
  }
}

/**
 * Read and verify the session cookie from the server component / API route
 * using the `cookies()` dynamic API.
 */
export async function getSession(): Promise<SessionUser | null> {
  let cookieStore;
  try {
    cookieStore = await cookies();
  } catch {
    return null;
  }
  const cookie = cookieStore.get(COOKIE_NAME);
  if (!cookie?.value) return null;
  try {
    const { payload } = await jwtVerify(cookie.value, SECRET);
    return payload as unknown as SessionUser;
  } catch {
    return null;
  }
}

/** Check if the request has a valid session (for middleware use). */
export async function isAuthenticated(req: NextRequest): Promise<boolean> {
  return (await getSessionFromRequest(req)) !== null;
}
