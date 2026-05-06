'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ALL_NAV_ITEMS,
  DEFAULT_MIDDLE,
  MAX_MIDDLE_MOBILE,
  NAV_EVENT,
  NavItem,
  loadMiddle,
  moreMatchPrefixes,
} from './nav-items';

function isActive(prefixes: readonly string[], pathname: string) {
  return prefixes.some(p => pathname === p || pathname.startsWith(p + '/'));
}

function buildItems(middle: string[], slice: number): NavItem[] {
  const first = ALL_NAV_ITEMS.find(i => i.pinned === 'first');
  const last  = ALL_NAV_ITEMS.find(i => i.pinned === 'last');
  const mid: NavItem[] = [];
  for (const k of middle.slice(0, slice)) {
    const m = ALL_NAV_ITEMS.find(i => i.key === k);
    if (m && !m.pinned) mid.push(m);
  }
  return [first!, ...mid, last!];
}

export default function Nav() {
  const pathname = usePathname();

  const [middle, setMiddle] = useState<string[]>(DEFAULT_MIDDLE);

  useEffect(() => {
    setMiddle(loadMiddle());
    const handler = () => setMiddle(loadMiddle());
    window.addEventListener(NAV_EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(NAV_EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  // Mobile: Home + first 3 middle + More (always)
  const mobileItems = buildItems(middle, MAX_MIDDLE_MOBILE);
  const mobileMore  = moreMatchPrefixes(middle.slice(0, MAX_MIDDLE_MOBILE));

  // Desktop: Home + ALL middle (up to 6) + More only if anything overflows.
  // Up to 8 total slots (1 + 6 + 1).
  const desktopMiddle = middle;
  const desktopMidItems = desktopMiddle
    .map(k => ALL_NAV_ITEMS.find(i => i.key === k))
    .filter((i): i is NavItem => !!i && !i.pinned);
  const first = ALL_NAV_ITEMS.find(i => i.pinned === 'first')!;
  const last  = ALL_NAV_ITEMS.find(i => i.pinned === 'last')!;
  const desktopMorePrefixes = moreMatchPrefixes(desktopMiddle);
  // Hide More on desktop if every routable non-pinned item is already in the bar
  const allMiddleKeys = ALL_NAV_ITEMS.filter(i => !i.pinned).map(i => i.key);
  const overflowExists = allMiddleKeys.some(k => !desktopMiddle.includes(k));
  const desktopItems: NavItem[] = overflowExists
    ? [first, ...desktopMidItems, last]
    : [first, ...desktopMidItems];

  return (
    <>
      {/* ── Desktop: top horizontal nav ── */}
      <header className="hidden md:flex h-16 border-b border-gray-800 bg-gray-950 items-center flex-shrink-0">
        <nav className="w-full max-w-5xl mx-auto px-8 flex gap-1 flex-wrap">
          {desktopItems.map(({ key, href, label, icon, matchPrefixes }) => {
            const prefixes = key === 'more' ? desktopMorePrefixes : matchPrefixes;
            const active = isActive(prefixes, pathname);
            return (
              <Link
                key={key}
                href={href}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  active ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
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
          {mobileItems.map(({ key, href, label, icon, matchPrefixes }) => {
            const prefixes = key === 'more' ? mobileMore : matchPrefixes;
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
