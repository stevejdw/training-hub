import type { ReactNode } from 'react';

/** Single source of truth for top-level navigation items.
 *  Used by both `Nav.tsx` (the actual bar) and the Edit Menu Bar page.
 *
 *  - Items with `pinned: 'first'` always appear at the start of the bar.
 *  - Items with `pinned: 'last'` always appear at the end (and act as the
 *    overflow target — anything not visible in the bar is reachable via More).
 *  - Other items are user-customisable middle slots, capped at MAX_MIDDLE.
 */
export interface NavItem {
  key: string;
  href: string;
  label: string;
  matchPrefixes: string[];
  icon: ReactNode;
  pinned?: 'first' | 'last';
}

const homeIcon = (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
  </svg>
);

const activitiesIcon = (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <circle cx="12" cy="4" r="2" fill="currentColor" stroke="none" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 9l4 2v3l-2 7M19 9l-4 2v3l2 7M9 11h6" />
  </svg>
);

const trainingIcon = (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 17l6-6 4 4 8-8M14 7h7v7" />
  </svg>
);

const eventsIcon = (
  // Trophy
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 21h8m-4-4v4m6-17v3a4 4 0 01-4 4h-4a4 4 0 01-4-4V4h12zM4 5v2a3 3 0 003 3M20 5v2a3 3 0 01-3 3" />
  </svg>
);

const goalsIcon = (
  // Target / bullseye
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);

const chatIcon = (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
);

const profileIcon = (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
);

const settingsIcon = (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.071 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const moreIcon = (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <circle cx="6"  cy="12" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="18" cy="12" r="1.7" fill="currentColor" stroke="none" />
  </svg>
);

export const ALL_NAV_ITEMS: NavItem[] = [
  { key: 'home',           href: '/home',           label: 'Home',           matchPrefixes: ['/home', '/feed'],           icon: homeIcon,         pinned: 'first' },
  { key: 'activities',     href: '/activities',     label: 'Activities',     matchPrefixes: ['/activities'],              icon: activitiesIcon },
  { key: 'training',       href: '/training',       label: 'Training',       matchPrefixes: ['/training', '/performance', '/fitness'], icon: trainingIcon },
  { key: 'events',         href: '/events',         label: 'Events',         matchPrefixes: ['/events'],                  icon: eventsIcon },
  { key: 'goals',          href: '/goals',          label: 'Goals',          matchPrefixes: ['/goals'],                   icon: goalsIcon },
  { key: 'chat',           href: '/chat',           label: 'Coach AI',       matchPrefixes: ['/chat'],                    icon: chatIcon },
  { key: 'profile',        href: '/profile',        label: 'Profile',        matchPrefixes: ['/profile'],                 icon: profileIcon },
  { key: 'settings',       href: '/settings',       label: 'Settings',       matchPrefixes: ['/settings'],                icon: settingsIcon },
  { key: 'more',           href: '/more',           label: 'More',           matchPrefixes: ['/more'],                    icon: moreIcon,         pinned: 'last' },
];

export const STORAGE_KEY    = 'nav-bar-config';
export const NAV_EVENT      = 'nav-config-changed';
export const DEFAULT_MIDDLE = ['activities', 'training', 'events'];

export const STORAGE_KEY_DESKTOP    = 'nav-bar-config-desktop';
export const NAV_EVENT_DESKTOP      = 'nav-config-desktop-changed';
export const DEFAULT_MIDDLE_DESKTOP = ['activities', 'training', 'events', 'goals', 'chat', 'profile'];

/** Maximum number of middle slots a user can configure. */
export const MAX_MIDDLE        = 6;
export const MAX_MIDDLE_MOBILE = 3;

/** Performance merged into Training. A bar saved before that names both
 *  collapses to one slot, so top the result back up from the defaults rather
 *  than leaving the user a tab short of what they had. */
function migrateKeys(keys: string[], defaults: string[]): string[] {
  const out: string[] = [];
  for (const k of keys) {
    const mapped = k === 'performance' ? 'training' : k;
    if (typeof mapped === 'string' && !out.includes(mapped)) out.push(mapped);
  }
  if (out.length < keys.length) {
    for (const d of defaults) {
      if (out.length >= keys.length) break;
      if (!out.includes(d)) out.push(d);
    }
  }
  return out;
}

const middleKeys = new Set(ALL_NAV_ITEMS.filter(i => !i.pinned).map(i => i.key));

/** Read the user's chosen middle-slot keys from localStorage. Returns the
 *  default order if storage is empty/invalid. Always client-only. */
export function loadMiddle(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_MIDDLE;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return DEFAULT_MIDDLE;
    const seen = new Set<string>();
    const cleaned = migrateKeys(arr as string[], DEFAULT_MIDDLE)
      .filter((k): k is string => typeof k === 'string' && middleKeys.has(k))
      .filter(k => seen.has(k) ? false : (seen.add(k), true))
      .slice(0, MAX_MIDDLE);
    return cleaned.length > 0 ? cleaned : DEFAULT_MIDDLE;
  } catch {
    return DEFAULT_MIDDLE;
  }
}

/** Persist the middle slots and notify listeners in this tab. */
export function saveMiddle(middle: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(middle));
  } catch { /* ignore */ }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(NAV_EVENT, { detail: middle }));
  }
}

/** Read the desktop-specific middle-slot keys from localStorage. */
export function loadMiddleDesktop(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DESKTOP);
    if (!raw) return DEFAULT_MIDDLE_DESKTOP;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return DEFAULT_MIDDLE_DESKTOP;
    const seen = new Set<string>();
    const cleaned = migrateKeys(arr as string[], DEFAULT_MIDDLE_DESKTOP)
      .filter((k): k is string => typeof k === 'string' && middleKeys.has(k))
      .filter(k => seen.has(k) ? false : (seen.add(k), true))
      .slice(0, MAX_MIDDLE);
    return cleaned.length > 0 ? cleaned : DEFAULT_MIDDLE_DESKTOP;
  } catch {
    return DEFAULT_MIDDLE_DESKTOP;
  }
}

/** Persist the desktop middle slots and notify listeners in this tab. */
export function saveMiddleDesktop(middle: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY_DESKTOP, JSON.stringify(middle));
  } catch { /* ignore */ }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(NAV_EVENT_DESKTOP, { detail: middle }));
  }
}

/** Resolve the ordered list of NavItems to render in the bar from the
 *  middle keys, taking pinned items from ALL_NAV_ITEMS. */
export function resolveBarItems(middle: string[]): NavItem[] {
  const first = ALL_NAV_ITEMS.find(i => i.pinned === 'first');
  const last  = ALL_NAV_ITEMS.find(i => i.pinned === 'last');
  const middleItems: NavItem[] = [];
  for (const k of middle) {
    const m = ALL_NAV_ITEMS.find(i => i.key === k);
    if (m && !m.pinned) middleItems.push(m);
  }
  return [...(first ? [first] : []), ...middleItems, ...(last ? [last] : [])];
}

/** Look up a nav item's icon by key, for use in PageHeader on each page. */
export function iconFor(key: string): NavItem['icon'] | null {
  return ALL_NAV_ITEMS.find(i => i.key === key)?.icon ?? null;
}

/** Build the active-state matchPrefixes for the More tab: anything that
 *  isn't visible in the bar should still light up More when you're there. */
export function moreMatchPrefixes(middle: string[]): string[] {
  const visibleKeys = new Set([
    ...ALL_NAV_ITEMS.filter(i => i.pinned).map(i => i.key),
    ...middle,
  ]);
  const prefixes = new Set<string>(['/more']);
  for (const item of ALL_NAV_ITEMS) {
    if (!visibleKeys.has(item.key)) {
      for (const p of item.matchPrefixes) prefixes.add(p);
    }
  }
  return Array.from(prefixes);
}
