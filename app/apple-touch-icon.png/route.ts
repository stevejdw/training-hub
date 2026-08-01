import { NextResponse } from 'next/server';
import { getProfile } from '@/lib/profile';

// Resolve the apple-touch-icon to the icon currently selected in Settings.
// Must live at the conventional /apple-touch-icon.png path — Safari's
// "Add to Dock"/"Add to Home Screen" fetch that exact filename directly and
// don't reliably follow the <link rel="apple-touch-icon"> tag, so a static
// file at this path (as this used to be) permanently shadows any dynamic
// icon logic. Keeping the profile DB read here (instead of in the root
// layout's metadata) lets the rest of the app render statically and keeps
// navigation fast.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const profile = await getProfile().catch(() => null);
  const icon = profile?.app_icon ?? 'speed';
  return NextResponse.redirect(new URL(`/app-icon-${icon}.png`, request.url));
}
