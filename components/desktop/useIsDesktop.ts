'use client';

import { useSyncExternalStore } from 'react';

const QUERY = '(min-width: 1024px)';

function subscribe(callback: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

/** True at the lg (≥1024px) breakpoint — the desktop shell.
 *  Use to branch between mobile and desktop component trees so the
 *  inactive tree never mounts (no double data-fetching, and Recharts
 *  never measures a display:none container). SSR snapshot is false;
 *  gate on a mounted flag before branching to avoid hydrating the
 *  wrong tree on desktop. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
