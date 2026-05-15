import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAuthenticated } from '@/lib/auth';

/** Routes that do NOT require authentication. */
const PUBLIC_ROUTES = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/strava/auth',
  '/api/strava/callback',
  '/api/strava/webhook',  // Strava posts activity events here without a session
];

/**
 * API routes called by GitHub Actions cron workflows. They authenticate via
 * a shared secret in the Authorization header rather than a session cookie.
 */
const CRON_ROUTES = [
  '/api/activities/backfill',
  '/api/segments/starred',
];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public routes
  if (PUBLIC_ROUTES.some(route => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Allow cron routes when the shared secret matches
  if (CRON_ROUTES.some(route => pathname.startsWith(route))) {
    const expected = process.env.CRON_SECRET;
    const provided = req.headers.get('authorization');
    if (expected && provided === `Bearer ${expected}`) {
      return NextResponse.next();
    }
    // Otherwise fall through to session-based auth below — a logged-in user
    // (e.g. clicking a button in Settings) should still be able to call these.
  }

  // Allow static files and Next.js internals
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/apple-icon') ||
    pathname.startsWith('/icon') ||
    pathname.startsWith('/manifest') ||
    pathname === '/' ||
    pathname.match(/\.(ico|png|svg|jpg|jpeg|webp|json)$/)
  ) {
    return NextResponse.next();
  }

  // Check authentication
  const authenticated = await isAuthenticated(req);
  if (!authenticated) {
    // Redirect to login page for pages; return 401 for API routes
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all request paths except static files and next internals
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
