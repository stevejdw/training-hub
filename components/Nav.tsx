'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Top-level navigation items.
 *  The order here is also the default order in the bottom mobile tab bar.
 *  Edit Menu Bar (under More) will eventually let users reorder/hide,
 *  but Home is always first. */
const NAV_ITEMS = [
  {
    key: 'home',
    href: '/home',
    label: 'Home',
    matchPrefixes: ['/home', '/feed'],
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    key: 'activities',
    href: '/activities',
    label: 'Activities',
    matchPrefixes: ['/activities'],
    // Strava-style "person stretching" silhouette — exercise/activity icon
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="12" cy="4" r="2" fill="currentColor" stroke="none" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 9l4 2v3l-2 7M19 9l-4 2v3l2 7M9 11h6" />
      </svg>
    ),
  },
  {
    key: 'performance',
    href: '/performance',
    label: 'Performance',
    matchPrefixes: ['/performance', '/fitness'],
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    key: 'training',
    href: '/training',
    label: 'Training',
    matchPrefixes: ['/training'],
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    key: 'more',
    href: '/more',
    label: 'More',
    matchPrefixes: ['/more', '/chat', '/profile', '/settings'],
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="6"  cy="12" r="1.7" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
        <circle cx="18" cy="12" r="1.7" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
] as const;

function isActive(prefixes: readonly string[], pathname: string) {
  return prefixes.some(p => pathname === p || pathname.startsWith(p + '/'));
}

export default function Nav() {
  const pathname = usePathname();

  return (
    <>
      {/* ── Desktop: top horizontal nav, no profile/settings icon ── */}
      <header className="hidden md:flex h-16 border-b border-gray-800 bg-gray-950 items-center px-6 gap-8 flex-shrink-0">
        <Link href="/home" className="flex items-center gap-2">
          <span className="text-xl">🚴</span>
          <span className="font-semibold text-white tracking-tight">Training Hub</span>
        </Link>
        <nav className="flex gap-1">
          {NAV_ITEMS.map(({ key, href, label, icon, matchPrefixes }) => {
            const active = isActive(matchPrefixes, pathname);
            return (
              <Link
                key={key}
                href={href}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-orange-500 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                {icon}
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
      </header>

      {/* ── Mobile: fixed bottom tab bar ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-gray-950 border-t border-gray-800">
        <div className="flex h-[73px] pb-4">
          {NAV_ITEMS.map(({ key, href, label, icon, matchPrefixes }) => {
            const active = isActive(matchPrefixes, pathname);
            return (
              <Link
                key={key}
                href={href}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  active ? 'text-orange-500' : 'text-gray-500'
                }`}
              >
                {icon}
                <span className="text-[10px] font-medium tracking-wide">{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
