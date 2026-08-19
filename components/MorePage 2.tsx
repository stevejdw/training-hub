'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import PageHeader from './PageHeader';
import {
  ALL_NAV_ITEMS,
  DEFAULT_MIDDLE,
  MAX_MIDDLE_MOBILE,
  NAV_EVENT,
  NavItem,
  iconFor,
  loadMiddle,
} from './nav-items';

function ItemRow({ item }: { item: NavItem }) {
  return (
    <Link
      href={item.href}
      className="flex items-center gap-3 px-4 py-3.5 hover:bg-raised/40 active:bg-raised/60 transition-colors"
    >
      <span className="text-accent-hi flex-shrink-0">{item.icon}</span>
      <span className="text-base text-ink font-medium flex-1">{item.label}</span>
      <svg className="w-5 h-5 text-ink-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

const editMenuItem: NavItem = {
  key: 'edit-menu',
  href: '/more/edit-menu',
  label: 'Edit Menu Bar',
  matchPrefixes: ['/more/edit-menu'],
  icon: (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  ),
};

export default function MorePage() {
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

  // On mobile the bar shows Home + first MAX_MIDDLE_MOBILE of middle.
  // Anything NOT in that visible set should appear here in More.
  const visible = new Set([
    ...ALL_NAV_ITEMS.filter(i => i.pinned).map(i => i.key),
    ...middle.slice(0, MAX_MIDDLE_MOBILE),
  ]);
  const overflow = ALL_NAV_ITEMS.filter(i => !i.pinned && !visible.has(i.key));

  return (
    <div className="h-full flex flex-col">
      <PageHeader icon={iconFor('more')} title="More" />
      <div className="flex-1 overflow-y-auto scroll-touch">
        <div className="max-w-2xl md:max-w-5xl mx-auto">

        {overflow.length > 0 && (
          <div className="bg-surface border-y border-line mb-2 divide-y divide-line/60">
            {overflow.map(item => <ItemRow key={item.key} item={item} />)}
          </div>
        )}

        <div className="bg-surface border-y border-line mb-2 divide-y divide-line/60">
          <ItemRow item={editMenuItem} />
        </div>

          <div className="h-20" />
        </div>
      </div>
    </div>
  );
}
