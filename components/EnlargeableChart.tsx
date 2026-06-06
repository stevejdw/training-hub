'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface EnlargeableChartProps {
  /** Render the chart. `fullscreen` is true when shown in the fullscreen overlay,
   *  so the ResponsiveContainer height can switch to "100%". */
  children: (fullscreen: boolean) => ReactNode;
  /** Title shown in the fullscreen overlay header (the chart's intro heading). */
  title?: string;
  /** Optional secondary line shown under the title in the fullscreen overlay. */
  subtitle?: string;
  /** Optional chart controls (e.g. period selector) shown in the fullscreen header. */
  controls?: ReactNode;
  /** Extra classes for the inline wrapper. */
  className?: string;
}

/**
 * Wraps a chart and adds a small "enlarge" icon to its top-right corner.
 * Clicking it shows the same chart in a full-screen overlay.
 */
export default function EnlargeableChart({ children, title, subtitle, controls, className }: EnlargeableChartProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

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

      {open && mounted && createPortal(
        <div
          className="fixed inset-0 z-[2147483647] flex flex-col bg-gray-950"
          style={{
            paddingTop:    'max(1rem, env(safe-area-inset-top))',
            paddingRight:  'max(1rem, env(safe-area-inset-right))',
            paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
            paddingLeft:   'max(1rem, env(safe-area-inset-left))',
          }}
        >
          {/* Header sits above the chart in its own stacking layer so its
              controls/close button stay tappable in any orientation. */}
          <div className="relative z-10 shrink-0 flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-200 truncate">{title ?? 'Chart'}</p>
              {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {controls}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close fullscreen"
                title="Close"
                className="shrink-0 flex items-center justify-center w-10 h-10 rounded-lg bg-gray-800 text-gray-300 hover:text-white hover:bg-gray-700 active:bg-gray-600 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          <div className="relative z-0 flex-1 min-h-0 overflow-hidden">
            {children(true)}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
