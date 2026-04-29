'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

interface Item {
  href: string;
  label: string;
  icon: ReactNode;
}

interface Section {
  items: Item[];
}

const SECTIONS: Section[] = [
  {
    items: [
      {
        href: '/chat',
        label: 'Coach AI',
        icon: (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        ),
      },
    ],
  },
  {
    items: [
      {
        href: '/profile',
        label: 'Profile',
        icon: (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        ),
      },
      {
        href: '/settings',
        label: 'Settings',
        icon: (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.071 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
    ],
  },
  {
    items: [
      {
        href: '/more/edit-menu',
        label: 'Edit Menu Bar',
        icon: (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        ),
      },
    ],
  },
];

function ItemRow({ item }: { item: Item }) {
  return (
    <Link
      href={item.href}
      className="flex items-center gap-3 px-4 py-3.5 hover:bg-gray-800/40 active:bg-gray-800/60 transition-colors"
    >
      <span className="text-orange-400 flex-shrink-0">{item.icon}</span>
      <span className="text-base text-gray-100 font-medium flex-1">{item.label}</span>
      <svg className="w-5 h-5 text-gray-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

export default function MorePage() {
  return (
    <div className="h-full overflow-y-auto scroll-touch">
      <div className="max-w-2xl md:max-w-3xl mx-auto">
        {/* Page header — Strava-style centered title */}
        <div className="px-4 py-4 md:py-6 text-center md:text-left">
          <h1 className="text-xl md:text-2xl font-bold text-white">More</h1>
        </div>

        {SECTIONS.map((section, i) => (
          <div key={i} className="bg-gray-900 border-y border-gray-800 mb-2 divide-y divide-gray-800/60">
            {section.items.map(item => (
              <ItemRow key={item.href} item={item} />
            ))}
          </div>
        ))}

        <div className="h-16" />
      </div>
    </div>
  );
}
