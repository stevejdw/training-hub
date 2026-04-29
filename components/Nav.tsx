'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ALL_NAV_ITEMS,
  DEFAULT_MIDDLE,
  NAV_EVENT,
  loadMiddle,
  moreMatchPrefixes,
  resolveBarItems,
} from './nav-items';

function isActive(prefixes: readonly string[], pathname: string) {
  return prefixes.some(p => pathname === p || pathname.startsWith(p + '/'));
}

export default function Nav() {
  const pathname = usePathname();

  // Server + first client render use defaults to avoid hydration mismatch.
  // After mount, hydrate from localStorage and listen for live updates from
  // the Edit Menu Bar page.
  const [middle, setMiddle] = useState<string[]>(DEFAULT_MIDDLE);

  useEffect(() => {
    setMiddle(loadMiddle());
    const handler = () => setMiddle(loadMiddle());
    window.addEventListener(NAV_EVENT, handler);
    window.addEventListener('storage', handler); // cross-tab
    return () => {
      window.removeEventListener(NAV_EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const barItems     = resolveBarItems(middle);
  const morePrefixes = moreMatchPrefixes(middle);

  // Desktop nav shows everything in a fixed canonical order
  const desktopItems = ALL_NAV_ITEMS;

  return (
    <>
      {/* ── Desktop: top horizontal nav ── */}
      <header className="hidden md:flex h-16 border-b border-gray-800 bg-gray-950 items-center px-6 gap-8 flex-shrink-0">
        <Link href="/home" className="flex items-center gap-2">
          <span className="text-xl">🚴</span>
          <span className="font-semibold text-white tracking-tight">Training Hub</span>
        </Link>
        <nav className="flex gap-1">
          {desktopItems.map(({ key, href, label, icon, matchPrefixes }) => {
            const prefixes = key === 'more' ? morePrefixes : matchPrefixes;
            const active = isActive(prefixes, pathname);
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

      {/* ── Mobile: fixed bottom tab bar (user-customisable) ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-gray-950 border-t border-gray-800">
        <div className="flex h-[73px] pb-4">
          {barItems.map(({ key, href, label, icon, matchPrefixes }) => {
            const prefixes = key === 'more' ? morePrefixes : matchPrefixes;
            const active = isActive(prefixes, pathname);
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
