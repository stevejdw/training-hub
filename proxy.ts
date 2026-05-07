import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAuthenticated } from '@/lib/auth';

/** Routes that do NOT require authentication. */
const PUBLIC_ROUTES = [
  '/login',
  '/api/strava/auth',
  '/api/strava/callback',
];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public routes
  if (PUBLIC_ROUTES.some(route => pathname.startsWith(route))) {
    return NextResponse.next();
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
