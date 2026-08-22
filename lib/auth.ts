import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';

/**
 * The key the session JWT is signed and verified with.
 *
 * This used to fall through to a literal `'fallback-dev-secret-...'` string.
 * While the repository was private that was merely untidy; now that it is
 * public, that literal is a published signing key — anyone could mint a valid
 * session cookie for any deployment that happened to be missing the
 * environment variable. So in production a missing secret is a hard failure
 * rather than a silent downgrade: fail closed, never fall back.
 *
 * STRAVA_CLIENT_SECRET stays in the chain because AUTH_SECRET is currently
 * only set on Production, and preview deployments (which also run with
 * NODE_ENV=production) would otherwise refuse every request. Both are real
 * secrets; the literal is not.
 *
 * Resolved lazily and memoised rather than at module scope, so a
 * misconfiguration surfaces as failing requests instead of a build that dies
 * during route collection.
 */
const DEV_ONLY_SECRET = 'fallback-dev-secret-do-not-use-in-prod';

let cachedSecret: Uint8Array | null = null;

function secret(): Uint8Array {
  if (cachedSecret) return cachedSecret;

  const configured = process.env.AUTH_SECRET ?? process.env.STRAVA_CLIENT_SECRET;
  if (!configured) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'AUTH_SECRET is not set. Sessions cannot be signed safely without it — ' +
          'refusing to fall back to a development key in production.',
      );
    }
    cachedSecret = new TextEncoder().encode(DEV_ONLY_SECRET);
    return cachedSecret;
  }

  cachedSecret = new TextEncoder().encode(configured);
  return cachedSecret;
}

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
    .sign(secret());

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
    const { payload } = await jwtVerify(cookie.value, secret());
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
    const { payload } = await jwtVerify(cookie.value, secret());
    return payload as unknown as SessionUser;
  } catch {
    return null;
  }
}

/** Check if the request has a valid session (for middleware use). */
export async function isAuthenticated(req: NextRequest): Promise<boolean> {
  return (await getSessionFromRequest(req)) !== null;
}
