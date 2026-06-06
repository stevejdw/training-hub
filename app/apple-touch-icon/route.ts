import { NextResponse } from 'next/server';
import { getProfile } from '@/lib/profile';

// Resolve the iOS apple-touch-icon to the icon currently selected in Settings.
// This lookup is intentionally isolated in its own route handler: iOS only
// fetches the apple-touch-icon when adding to the home screen, so keeping the
// profile DB read here (instead of in the root layout's metadata) lets the rest
// of the app render statically and keeps navigation fast.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const profile = await getProfile().catch(() => null);
  const icon = profile?.app_icon ?? 'speed';
  return NextResponse.redirect(new URL(`/app-icon-${icon}.png`, request.url));
}
