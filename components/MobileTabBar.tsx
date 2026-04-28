'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Tab<K extends string> {
  key: K;
  label: string;
  icon: ReactNode;
}

/** Mobile-only horizontal sub-tab bar with fixed-width cells. If the
 *  tabs don't all fit, the trailing ones collapse into a "...More"
 *  cell that opens a popover with the overflow + a "More" indicator
 *  if any of the active tab is in the popover. Hidden on md+.
 *
 *  Per-cell width is ~96px (icon + short label). Resize is observed
 *  so the breakpoint adapts to device rotation / app width. */
export default function MobileTabBar<K extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: Tab<K>[];
  active: K;
  onSelect: (key: K) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(tabs.length);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (!wrapRef.current) return;
    const CELL_PX = 92; // each tab cell width target
    const MORE_PX = 64; // "More" cell width target (compact stacked layout)

    const update = () => {
      const w = wrapRef.current?.clientWidth ?? 0;
      if (w === 0) return;
      const fitsAll = Math.floor(w / CELL_PX);
      if (fitsAll >= tabs.length) {
        setVisibleCount(tabs.length);
      } else {
        // Reserve room for the "More" cell, then see how many real cells fit.
        const fit = Math.max(1, Math.floor((w - MORE_PX) / CELL_PX));
        setVisibleCount(fit);
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [tabs.length]);

  // Close popover on outside click
  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-mobile-tab-more]')) setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [moreOpen]);

  const visible  = tabs.slice(0, visibleCount);
  const overflow = tabs.slice(visibleCount);
  const activeInOverflow = overflow.some(t => t.key === active);

  return (
    <div
      ref={wrapRef}
      // Right padding reserves space for the fixed top-right Profile icon
      // so the rightmost tab cell never sits under it.
      className="md:hidden flex-shrink-0 flex border-b border-gray-800 relative pr-12"
    >
      {visible.map(({ key, label, icon }) => (
        <button
          key={key}
          onClick={() => onSelect(key)}
          className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 px-1 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
            active === key
              ? 'border-orange-500 text-white'
              : 'border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-600'
          }`}
        >
          <span className="flex-shrink-0">{icon}</span>
          <span className="truncate">{label}</span>
        </button>
      ))}

      {overflow.length > 0 && (
        <div className="flex-1 min-w-0 relative" data-mobile-tab-more>
          <button
            onClick={() => setMoreOpen(o => !o)}
            className={`w-full h-full flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium border-b-2 transition-colors -mb-px ${
              activeInOverflow || moreOpen
                ? 'border-orange-500 text-white'
                : 'border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-600'
            }`}
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <circle cx="5"  cy="12" r="1.6" fill="currentColor" />
              <circle cx="12" cy="12" r="1.6" fill="currentColor" />
              <circle cx="19" cy="12" r="1.6" fill="currentColor" />
            </svg>
            <span className="truncate leading-none">More</span>
          </button>
          {moreOpen && (
            <div className="absolute right-0 top-full mt-1 w-56 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl py-1 z-50">
              {overflow.map(({ key, label, icon }) => (
                <button
                  key={key}
                  onClick={() => { onSelect(key); setMoreOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
                    active === key
                      ? 'bg-orange-500/15 text-orange-400'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`}
                >
                  <span className="flex-shrink-0 text-gray-500">{icon}</span>
                  <span className="truncate text-left">{label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
