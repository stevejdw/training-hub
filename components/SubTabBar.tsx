'use client';

import type { ReactNode } from 'react';

/** Strava-style sub-tab bar — at most 2 tabs, evenly split, with an
 *  underline indicator under the active tab. Used for second-level
 *  navigation under each top-level menu item. */
export default function SubTabBar<K extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: { key: K; label: string; icon?: ReactNode }[];
  active: K;
  onSelect: (key: K) => void;
}) {
  return (
    <div className="flex-shrink-0 flex border-b border-gray-800">
      {tabs.map(({ key, label, icon }) => (
        <button
          key={key}
          onClick={() => onSelect(key)}
          className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-semibold border-b-2 transition-colors -mb-px ${
            active === key
              ? 'border-orange-500 text-white'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          {icon}
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
