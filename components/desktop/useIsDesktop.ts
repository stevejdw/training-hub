'use client';

import { useSyncExternalStore } from 'react';

export type LayoutMode = 'mobile' | 'tablet' | 'desktop';

/* Height clauses matter: a rotated iPhone is 852×393 — wider than the md
 * breakpoint. Safari and the installed PWA rotate freely regardless of the
 * manifest's `orientation: portrait`, so without the min-height a sideways
 * phone would match the tablet query and mount the desktop dashboard on a
 * 393px-tall screen (and fire its data fetches a second time).
 *
 * Thresholds against real devices: iPhone 16 Pro Max landscape 956×440 stays
 * mobile; iPad landscape 1024×768 is desktop; iPad portrait 768×1024 is
 * desktop, as it was before. */
const MQ_TABLET  = '(min-width: 768px) and (min-height: 500px)';
const MQ_DESKTOP = '(min-width: 1024px) and (min-height: 600px)';

function subscribe(callback: () => void) {
  const a = window.matchMedia(MQ_TABLET);
  const b = window.matchMedia(MQ_DESKTOP);
  a.addEventListener('change', callback);
  b.addEventListener('change', callback);
  return () => {
    a.removeEventListener('change', callback);
    b.removeEventListener('change', callback);
  };
}

function snapshot(): LayoutMode {
  if (window.matchMedia(MQ_DESKTOP).matches) return 'desktop';
  if (window.matchMedia(MQ_TABLET).matches)  return 'tablet';
  return 'mobile';
}

/** Which of the three shells applies. Branch component trees on this so the
 *  inactive tree never mounts — no double data-fetching, and Recharts never
 *  measures a `display:none` container. SSR snapshot is 'mobile'; gate on a
 *  mounted flag before branching to avoid hydrating the wrong tree. */
export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(subscribe, snapshot, () => 'mobile');
}

/** True at the desktop breakpoint. Kept for existing call sites. */
export function useIsDesktop(): boolean {
  return useLayoutMode() === 'desktop';
}
