'use client';

import { useEffect, useState, type ReactNode } from 'react';

interface EnlargeableChartProps {
  /** Render the chart. `fullscreen` is true when shown in the fullscreen overlay,
   *  so the ResponsiveContainer height can switch to "100%". */
  children: (fullscreen: boolean) => ReactNode;
  /** Optional title shown in the fullscreen overlay header. */
  title?: string;
  /** Extra classes for the inline wrapper. */
  className?: string;
}

/**
 * Wraps a chart and adds a small "enlarge" icon to its top-right corner.
 * Clicking it shows the same chart in a full-screen overlay.
 */
export default function EnlargeableChart({ children, title, className }: EnlargeableChartProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = orig;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Enlarge chart"
        title="Enlarge"
        className="absolute top-0 right-0 z-10 p-1 rounded text-gray-500 hover:text-white hover:bg-gray-800/80 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
        </svg>
      </button>

      {children(false)}

      {open && (
        <div
          className="fixed inset-0 z-[100] flex flex-col bg-black/90 backdrop-blur-sm p-4 sm:p-6"
          onClick={() => setOpen(false)}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-200">{title ?? 'Chart'}</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close fullscreen"
              className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 min-h-0" onClick={e => e.stopPropagation()}>
            {children(true)}
          </div>
        </div>
      )}
    </div>
  );
}
