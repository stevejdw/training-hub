'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ALL_NAV_ITEMS } from './nav-items';

function isActive(prefixes: readonly string[], pathname: string) {
  return prefixes.some(p => pathname === p || pathname.startsWith(p + '/'));
}

/** Persistent left navigation rail, shown only at lg+ (≥1024px).
 *  Fixed-positioned so the root layout's flex column and the
 *  768–1023px top-header layout stay untouched — the content area
 *  clears it via margin-left (see .content-area in globals.css). */
export default function DesktopSidebar() {
  const pathname = usePathname();
  const [appIcon, setAppIcon] = useState<string>('speed');

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.json())
      .then((p: { app_icon?: string }) => { if (p.app_icon) setAppIcon(p.app_icon); })
      .catch(() => {});
  }, []);

  // Everything except More (redundant when all items are visible); Settings pinned at the bottom.
  const mainItems = ALL_NAV_ITEMS.filter(i => i.key !== 'more' && i.key !== 'settings');
  const settingsItem = ALL_NAV_ITEMS.find(i => i.key === 'settings')!;

  const linkClass = (active: boolean) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      active ? 'bg-orange-500/15 text-orange-400' : 'text-gray-400 hover:text-white hover:bg-gray-800'
    }`;

  return (
    <aside className="desktop-sidebar hidden lg:flex flex-col bg-gray-950 border-r border-gray-800">
      <Link href="/home" className="flex items-center gap-3 px-4 h-16 flex-shrink-0">
        <Image src={`/app-icon-${appIcon}.png`} alt="Training Hub" width={32} height={32} className="rounded-lg" />
        <span className="text-sm font-semibold text-white tracking-wide">Training Hub</span>
      </Link>

      <nav className="flex-1 flex flex-col gap-0.5 px-3 py-2 overflow-y-auto">
        {mainItems.map(({ key, href, label, icon, matchPrefixes }) => (
          <Link key={key} href={href} className={linkClass(isActive(matchPrefixes, pathname))}>
            {icon}
            <span>{label}</span>
          </Link>
        ))}
      </nav>

      <div className="px-3 py-3 border-t border-gray-800">
        <Link href={settingsItem.href} className={linkClass(isActive(settingsItem.matchPrefixes, pathname))}>
          {settingsItem.icon}
          <span>{settingsItem.label}</span>
        </Link>
      </div>
    </aside>
  );
}
