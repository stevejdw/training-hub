'use client';

import { useEffect } from 'react';

/**
 * Keeps the page at scale 1 on iOS.
 *
 * The mobile chrome is fixed-position: the bottom tab bar is pinned to the
 * layout viewport, so as soon as the visual viewport is scaled the bar sits
 * outside the screen and the user is stuck on whatever page they were on.
 * globals.css covers the CSS half (16px form controls, touch-action:
 * manipulation); this covers what CSS can't:
 *
 * - `gesturestart`/`gesturechange` are Safari-only pinch-zoom events.
 *   Preventing them stops page zoom without touching touch events, so
 *   Leaflet's own pinch handling on the activity map still works.
 * - A watchdog on visualViewport.scale, because iOS Safari ignores
 *   user-scalable=no. Rewriting the viewport meta with a pinned
 *   maximum-scale and releasing it on the next frame is the one reliable
 *   way to force the scale back to 1.
 */
export default function ViewportLock() {
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', stop, { passive: false });
    document.addEventListener('gesturechange', stop, { passive: false });
    document.addEventListener('gestureend', stop, { passive: false });

    const vv = window.visualViewport;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const reset = () => {
      const meta = document.querySelector('meta[name="viewport"]');
      if (!meta) return;
      const original = meta.getAttribute('content') ?? '';
      meta.setAttribute('content', `${original}, maximum-scale=1, user-scalable=no`);
      requestAnimationFrame(() => meta.setAttribute('content', original));
    };

    const onResize = () => {
      if (!vv) return;
      clearTimeout(timer);
      // Debounced: pinching fires this continuously, and snapping back
      // mid-gesture would fight the finger still on the glass.
      timer = setTimeout(() => {
        if (vv.scale > 1.01) reset();
      }, 300);
    };

    vv?.addEventListener('resize', onResize);

    return () => {
      document.removeEventListener('gesturestart', stop);
      document.removeEventListener('gesturechange', stop);
      document.removeEventListener('gestureend', stop);
      vv?.removeEventListener('resize', onResize);
      clearTimeout(timer);
    };
  }, []);

  return null;
}
