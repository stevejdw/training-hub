'use client';

import type { ReactNode } from 'react';
import SettingsGear from '@/components/SettingsGear';

/** Standard desktop page chrome: full-width title row + content region.
 *
 *  scroll=true (default) gives a normal scrolling page; false is for
 *  viewport-filling grid layouts whose panes scroll internally; 'lg' is that
 *  same layout only from lg up — below it the grid stacks and the page needs
 *  to scroll as a whole, which is what the tablet band requires. */
export default function DesktopPage({
  title,
  actions,
  children,
  scroll = true,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  scroll?: boolean | 'lg';
}) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-4 px-4 lg:px-8 pt-4 lg:pt-6 pb-4 flex-shrink-0">
        <h1 className="text-xl font-bold text-ink">{title}</h1>
        <div className="flex items-center gap-3">
          {actions}
          <SettingsGear />
        </div>
      </div>
      <div className={`flex-1 min-h-0 px-4 lg:px-8 pb-6 ${
        scroll === 'lg' ? 'overflow-y-auto lg:overflow-hidden'
          : scroll ? 'overflow-y-auto' : 'overflow-hidden'
      }`}>
        {children}
      </div>
    </div>
  );
}
