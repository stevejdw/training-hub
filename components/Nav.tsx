'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import DesktopSidebar from './DesktopSidebar';
import {
  ALL_NAV_ITEMS,
  DEFAULT_MIDDLE,
  MAX_MIDDLE_MOBILE,
  NAV_EVENT,
  NavItem,
  loadMiddle,
  moreMatchPrefixes,
} from './nav-items';
import { useAppIcon } from '@/components/ProfileProvider';

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
  const appIcon = useAppIcon();

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

  // Desktop: all items except 'more' and 'settings' (settings is the right icon)
  const desktopCenterItems = ALL_NAV_ITEMS.filter(i => i.key !== 'more' && i.key !== 'settings');
  const settingsItem = ALL_NAV_ITEMS.find(i => i.key === 'settings')!;

  return (
    <>
      {/* ── Desktop sidebar (lg+) ── */}
      <DesktopSidebar />

      {/* ── Tablet band (768–1023px): top horizontal nav ── */}
      <header className="tablet-header hidden md:flex lg:hidden h-16 border-b border-line bg-page items-center flex-shrink-0 relative">
        {/* Logo — pinned left */}
        <Link href="/home" className="absolute left-6 flex-shrink-0">
          <Image src={`/app-icon-${appIcon}.png`} alt="Training Hub" width={36} height={36} className="rounded-lg" />
        </Link>

        {/* Centred nav items */}
        <nav className="flex gap-1 items-center mx-auto">
          {desktopCenterItems.map(({ key, href, label, icon, matchPrefixes }) => {
            const active = isActive(matchPrefixes, pathname);
            return (
              <Link
                key={key}
                href={href}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  active ? 'bg-accent text-ink' : 'text-ink-3 hover:text-ink hover:bg-raised'
                }`}
              >
                {icon}
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Settings icon — pinned right */}
        <Link
          href="/settings"
          className={`absolute right-6 p-2 rounded-lg transition-colors ${
            isActive(['/settings'], pathname) ? 'text-accent' : 'text-ink-3 hover:text-ink hover:bg-raised'
          }`}
        >
          {settingsItem.icon}
        </Link>
      </header>

      {/* ── Mobile: fixed bottom tab bar ── */}
      <nav className="mobile-bottom-nav md:hidden fixed bottom-0 left-0 right-0 z-50 bg-page border-t border-line">
        <div className="mobile-bottom-nav-inner flex h-[73px] pb-4">
          {mobileItems.map(({ key, href, label, icon, matchPrefixes }) => {
            const prefixes = key === 'more' ? mobileMore : matchPrefixes;
            const active = isActive(prefixes, pathname);
            return (
              <Link
                key={key}
                href={href}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  active ? 'text-accent' : 'text-ink-4'
                }`}
              >
                {icon}
                <span className="text-micro font-medium tracking-wide">{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
