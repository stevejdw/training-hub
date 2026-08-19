'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Defers rendering its children until the section scrolls near the viewport
 * (400px lookahead). Used for below-the-fold chart sections so a page's
 * first paint isn't blocked by every tab's API calls firing at once.
 * Once shown, children stay mounted.
 */
export default function LazySection({
  children,
  placeholderHeight = 320,
}: {
  children: React.ReactNode;
  placeholderHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Starts hidden on server AND client so hydration matches; the effect
  // below reveals immediately when IntersectionObserver isn't available.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '400px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  return (
    <div ref={ref}>
      {visible ? children : <div style={{ height: placeholderHeight }} />}
    </div>
  );
}
