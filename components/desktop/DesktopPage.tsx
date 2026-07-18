'use client';

import type { ReactNode } from 'react';

/** Standard desktop page chrome: full-width title row + content region.
 *  scroll=true (default) gives a normal scrolling page; scroll=false is
 *  for viewport-filling grid layouts whose panes scroll internally. */
export default function DesktopPage({
  title,
  actions,
  children,
  scroll = true,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  scroll?: boolean;
}) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-4 px-8 pt-6 pb-4 flex-shrink-0">
        <h1 className="text-xl font-bold text-white">{title}</h1>
        {actions}
      </div>
      <div className={`flex-1 min-h-0 px-8 pb-6 ${scroll ? 'overflow-y-auto' : 'overflow-hidden'}`}>
        {children}
      </div>
    </div>
  );
}
