'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { iconFor } from '@/components/nav-items';

/** Settings, top-right, on every surface.
 *
 *  It used to live in three different places: a gear in the tablet header,
 *  a row pinned to the bottom of the desktop sidebar, and nothing at all on
 *  mobile — where it was two taps via More.
 *
 *  Reuses the gear already defined in nav-items.tsx rather than drawing
 *  another one. 40×40 tap target. */
export default function SettingsGear({ className = '' }: { className?: string }) {
  const pathname = usePathname();
  const active = pathname?.startsWith('/settings') ?? false;

  return (
    <Link
      href="/settings"
      aria-label="Settings"
      title="Settings"
      aria-current={active ? 'page' : undefined}
      className={`flex items-center justify-center w-10 h-10 rounded-lg transition-colors
        [&_svg]:w-5 [&_svg]:h-5
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        active ? 'text-accent' : 'text-ink-3 hover:text-ink hover:bg-raised'
      } ${className}`}
    >
      {iconFor('settings')}
    </Link>
  );
}
