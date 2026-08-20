'use client';

import type { ReactNode } from 'react';
import SettingsGear from '@/components/SettingsGear';

/**
 * The single header row for a tabbed screen on mobile.
 *
 * These screens used to stack three: PageHeader (logo, centred icon, title,
 * gear), then SubTabBar, then an in-page heading that repeated the sub-tab.
 * On Performance that was 345px of an 812px screen gone before the first
 * chart. The bottom tab bar already says which section you're in and the
 * active sub-tab says which view — so the title and the icon were saying it
 * a third and fourth time.
 *
 * One row: sub-tabs on the left (scrolling horizontally when there are more
 * than three), actions pinned right.
 */
export default function TabHeader<K extends string>({
  tabs,
  active,
  onSelect,
  right,
  showSettings = true,
}: {
  tabs: ReadonlyArray<{ key: K; label: string; icon?: ReactNode }>;
  active: K;
  onSelect: (key: K) => void;
  right?: ReactNode;
  showSettings?: boolean;
}) {
  return (
    <div className="flex-shrink-0 flex items-stretch border-b border-line bg-page">
      <div className="flex-1 min-w-0 flex overflow-x-auto scrollbar-none scroll-touch">
        {tabs.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => onSelect(key)}
            aria-current={active === key ? 'page' : undefined}
            className={`flex items-center justify-center gap-1.5 whitespace-nowrap px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              // Even thirds while they fit; natural width once the row
              // scrolls, so a fourth tab doesn't squeeze the labels.
              tabs.length <= 3 ? 'flex-1' : 'flex-none'
            } ${
              active === key
                ? 'border-accent text-ink'
                : 'border-transparent text-ink-4 hover:text-ink-2'
            }`}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </div>

      {(right || showSettings) && (
        <div className="flex-shrink-0 flex items-center gap-1 pl-2 pr-2 border-b border-line -mb-px">
          {right}
          {showSettings && <SettingsGear />}
        </div>
      )}
    </div>
  );
}
