'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ALL_NAV_ITEMS,
  DEFAULT_MIDDLE,
  DEFAULT_MIDDLE_DESKTOP,
  MAX_MIDDLE,
  MAX_MIDDLE_MOBILE,
  NavItem,
  loadMiddle,
  loadMiddleDesktop,
  saveMiddle,
  saveMiddleDesktop,
} from './nav-items';

type Tab = 'mobile' | 'desktop';

export default function EditMenuBar() {
  const [tab, setTab] = useState<Tab>('mobile');

  const [mobileMiddle, setMobileMiddle] = useState<string[]>(DEFAULT_MIDDLE);
  const [desktopMiddle, setDesktopMiddle] = useState<string[]>(DEFAULT_MIDDLE_DESKTOP);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setMobileMiddle(loadMiddle());
    setDesktopMiddle(loadMiddleDesktop());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveMiddle(mobileMiddle);
  }, [mobileMiddle, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    saveMiddleDesktop(desktopMiddle);
  }, [desktopMiddle, hydrated]);

  const first = ALL_NAV_ITEMS.find(i => i.pinned === 'first')!;
  const last  = ALL_NAV_ITEMS.find(i => i.pinned === 'last')!;

  const middle = tab === 'mobile' ? mobileMiddle : desktopMiddle;
  const setMiddle = tab === 'mobile' ? setMobileMiddle : setDesktopMiddle;
  const defaultMiddle = tab === 'mobile' ? DEFAULT_MIDDLE : DEFAULT_MIDDLE_DESKTOP;

  const middleItems: NavItem[] = middle
    .map(k => ALL_NAV_ITEMS.find(i => i.key === k))
    .filter((i): i is NavItem => !!i && !i.pinned);

  const used = new Set([first.key, last.key, ...middle]);
  const available = ALL_NAV_ITEMS.filter(i => !i.pinned && !used.has(i.key));

  function move(idx: number, delta: number) {
    const next = middle.slice();
    const j = idx + delta;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setMiddle(next);
  }

  function remove(key: string) {
    setMiddle(middle.filter(k => k !== key));
  }

  function add(key: string) {
    if (middle.length >= MAX_MIDDLE) return;
    setMiddle([...middle, key]);
  }

  function reset() {
    setMiddle(defaultMiddle);
  }

  const barFull = middle.length >= MAX_MIDDLE;

  return (
    <div className="h-full flex flex-col">
      <div className="flex-shrink-0 relative flex items-center justify-center px-4 md:px-8 py-3 md:py-4 border-b border-gray-800 bg-gray-950">
        <div className="flex items-center gap-2.5">
          <span className="text-orange-400 [&_svg]:w-6 [&_svg]:h-6 md:[&_svg]:w-7 md:[&_svg]:h-7 flex-shrink-0">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </span>
          <h1 className="text-lg md:text-xl font-bold text-white tracking-tight truncate">
            Edit Menu Bar
          </h1>
        </div>
        <div className="absolute right-4 md:right-8 flex items-center">
          <Link href="/more" className="text-sm text-gray-500 hover:text-orange-400 transition-colors">
            ← More
          </Link>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex-shrink-0 flex border-b border-gray-800 bg-gray-950">
        <button
          onClick={() => setTab('mobile')}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            tab === 'mobile'
              ? 'text-orange-400 border-b-2 border-orange-400'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Mobile
        </button>
        <button
          onClick={() => setTab('desktop')}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            tab === 'desktop'
              ? 'text-orange-400 border-b-2 border-orange-400'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Desktop
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scroll-touch">
      <div className="max-w-2xl md:max-w-5xl mx-auto p-4 md:p-8 space-y-5">

        <div>
          {tab === 'mobile' ? (
            <p className="text-sm text-gray-400">
              Pick up to {MAX_MIDDLE_MOBILE} items for the mobile bottom bar. Items not in the bar are reachable from More.
            </p>
          ) : (
            <p className="text-sm text-gray-400">
              Pick up to {MAX_MIDDLE} items for the desktop top nav. These settings are independent from mobile.
            </p>
          )}
        </div>

        {/* Live preview */}
        <div className="space-y-3">
          {tab === 'mobile' ? (
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider px-1 mb-1.5">Mobile preview</p>
              <BarPreview keys={[first.key, ...mobileMiddle.slice(0, MAX_MIDDLE_MOBILE), last.key]} />
            </div>
          ) : (
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider px-1 mb-1.5">Desktop preview</p>
              <BarPreview
                keys={(() => {
                  const allMid = ALL_NAV_ITEMS.filter(i => !i.pinned).map(i => i.key);
                  const overflow = allMid.some(k => !desktopMiddle.includes(k));
                  return overflow
                    ? [first.key, ...desktopMiddle, last.key]
                    : [first.key, ...desktopMiddle];
                })()}
                desktop
              />
            </div>
          )}
        </div>

        {/* In-bar list */}
        <section className="space-y-2">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1">
            In the bar
          </h2>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl divide-y divide-gray-800/60 overflow-hidden">
            <PinnedRow item={first} note="Always first" />
            {middleItems.map((item, idx) => (
              <div key={item.key} className="flex items-center gap-2 px-4 py-3">
                <span className="text-orange-400 flex-shrink-0">{item.icon}</span>
                <span className="text-base text-gray-100 font-medium flex-1">{item.label}</span>
                <button
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0}
                  aria-label="Move up"
                  className={`p-2 rounded-lg transition-colors ${
                    idx === 0
                      ? 'text-gray-700 cursor-not-allowed'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`}
                >
                  <ChevronIcon dir="up" />
                </button>
                <button
                  onClick={() => move(idx, +1)}
                  disabled={idx === middleItems.length - 1}
                  aria-label="Move down"
                  className={`p-2 rounded-lg transition-colors ${
                    idx === middleItems.length - 1
                      ? 'text-gray-700 cursor-not-allowed'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`}
                >
                  <ChevronIcon dir="down" />
                </button>
                <button
                  onClick={() => remove(item.key)}
                  aria-label={`Remove ${item.label}`}
                  className="ml-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-gray-300 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                >
                  Remove
                </button>
              </div>
            ))}
            {middleItems.length === 0 && (
              <div className="px-4 py-3 text-sm text-gray-500 italic">
                No middle items. Add some below.
              </div>
            )}
            <PinnedRow item={last} note="Always last" />
          </div>
        </section>

        {/* Available items */}
        <section className="space-y-2">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1">
            Available
            {barFull && (
              <span className="ml-2 text-[10px] normal-case font-normal text-gray-600">
                (bar is full — remove an item to add another)
              </span>
            )}
          </h2>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl divide-y divide-gray-800/60 overflow-hidden">
            {available.length === 0 ? (
              <div className="px-4 py-3 text-sm text-gray-500 italic">
                Everything is in the bar.
              </div>
            ) : available.map(item => (
              <div key={item.key} className="flex items-center gap-2 px-4 py-3">
                <span className="text-gray-500 flex-shrink-0">{item.icon}</span>
                <span className="text-base text-gray-200 font-medium flex-1">{item.label}</span>
                <button
                  onClick={() => add(item.key)}
                  disabled={barFull}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    barFull
                      ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                      : 'bg-orange-500/15 text-orange-400 hover:bg-orange-500/25'
                  }`}
                >
                  Add
                </button>
              </div>
            ))}
          </div>
        </section>

        <div className="flex justify-end pt-2">
          <button
            onClick={reset}
            className="text-xs text-gray-500 hover:text-orange-400 transition-colors"
          >
            Reset to defaults
          </button>
        </div>

        {/* Spacer so the bottom nav doesn't overlap content */}
        <div className="h-20" />
      </div>
      </div>
    </div>
  );
}

function PinnedRow({ item, note }: { item: NavItem; note: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 bg-gray-900/40">
      <span className="text-orange-400 flex-shrink-0">{item.icon}</span>
      <span className="text-base text-gray-100 font-medium flex-1">{item.label}</span>
      <span className="text-[10px] uppercase tracking-wider text-gray-600 font-semibold">
        {note}
      </span>
    </div>
  );
}

function BarPreview({ keys, desktop = false }: { keys: string[]; desktop?: boolean }) {
  const items = keys
    .map(k => ALL_NAV_ITEMS.find(i => i.key === k))
    .filter((i): i is NavItem => !!i);
  if (desktop) {
    return (
      <div className="bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 flex items-center gap-1 overflow-x-auto">
        <span className="text-base mr-2 flex-shrink-0">🚴</span>
        {items.map(({ key, label, icon }) => (
          <div
            key={key}
            className="flex items-center gap-2 px-2.5 py-1 rounded-lg text-xs text-gray-400 flex-shrink-0"
          >
            <span className="opacity-80 [&_svg]:w-4 [&_svg]:h-4">{icon}</span>
            <span>{label}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="bg-gray-950 border border-gray-800 rounded-2xl p-2">
      <div className="flex h-[73px] pb-4">
        {items.map(({ key, label, icon }) => (
          <div
            key={key}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 text-gray-500"
          >
            {icon}
            <span className="text-[10px] font-medium tracking-wide">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChevronIcon({ dir }: { dir: 'up' | 'down' }) {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
      {dir === 'up'
        ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        : <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />}
    </svg>
  );
}
