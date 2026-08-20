'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ALL_NAV_ITEMS } from './nav-items';
import { useAppIcon } from '@/components/ProfileProvider';

function isActive(prefixes: readonly string[], pathname: string) {
  return prefixes.some(p => pathname === p || pathname.startsWith(p + '/'));
}

/** Persistent left navigation rail, shown only at lg+ (≥1024px).
 *  Fixed-positioned so the root layout's flex column and the
 *  768–1023px top-header layout stay untouched — the content area
 *  clears it via margin-left (see .content-area in globals.css). */
export default function DesktopSidebar() {
  const pathname = usePathname();
  const appIcon = useAppIcon();

  // Everything except More (redundant when all items are visible); Settings pinned at the bottom.
  const mainItems = ALL_NAV_ITEMS.filter(i => i.key !== 'more' && i.key !== 'settings');

  const linkClass = (active: boolean) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      active ? 'bg-accent/15 text-accent-hi' : 'text-ink-3 hover:text-ink hover:bg-raised'
    }`;

  return (
    <aside className="desktop-sidebar hidden lg:flex flex-col bg-page border-r border-line">
      <Link href="/home" className="flex items-center gap-3 px-4 h-16 flex-shrink-0">
        <Image src={`/app-icon-${appIcon}.png`} alt="Training Hub" width={32} height={32} className="rounded-lg" />
        <span className="text-sm font-semibold text-ink tracking-wide">Training Hub</span>
      </Link>

      <nav className="flex-1 flex flex-col gap-0.5 px-3 py-2 pb-3 overflow-y-auto">
        {mainItems.map(({ key, href, label, icon, matchPrefixes }) => (
          <Link key={key} href={href} className={linkClass(isActive(matchPrefixes, pathname))}>
            {icon}
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
