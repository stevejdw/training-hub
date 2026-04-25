'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

export type DashboardTab = 'feed' | 'activities' | 'progress';

const NAV: { key: DashboardTab; label: string; icon: ReactNode }[] = [
  {
    key: 'feed', label: 'Feed',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h10M4 18h16" />
      </svg>
    ),
  },
  {
    key: 'activities', label: 'Activities',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    key: 'progress', label: 'Progress',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 17l6-6 4 4 8-8M14 7h7v7" />
      </svg>
    ),
  },
];

/** Link-based dashboard sidebar — used on detail pages where we need
 *  to navigate back to /dashboard?tab=X. DashboardHome itself uses an
 *  inline state-based version for snappy tab switching. */
export default function DashboardSidebar({ activeTab }: { activeTab?: DashboardTab }) {
  return (
    <aside className="hidden md:flex flex-col flex-shrink-0 w-56 border-r border-gray-800 bg-gray-950/50 py-6 px-3 gap-1">
      <div className="px-3 pb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
        Dashboard
      </div>
      {NAV.map(({ key, label, icon }) => {
        const active = activeTab === key;
        return (
          <Link
            key={key}
            href={`/dashboard?tab=${key}`}
            className={`flex items-center gap-2.5 text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              active
                ? 'bg-orange-500/15 text-orange-400 border-l-2 border-orange-500 pl-[10px]'
                : 'text-gray-400 hover:text-white hover:bg-gray-800/60'
            }`}
          >
            {icon}
            <span>{label}</span>
          </Link>
        );
      })}
    </aside>
  );
}
