'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

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
  /** Aspect ratio for the fullscreen plot. Defaults to a responsive ramp that
   *  keeps a sane shape at every width; override for charts whose natural
   *  proportion differs (a power curve reads better wide). */
  aspect?: string;
}

/**
 * Wraps a chart and adds a small "enlarge" icon to its top-right corner.
 * Clicking it shows the same chart full-screen.
 *
 * The overlay uses a native <dialog> shown with showModal(), so it renders in
 * the browser's top layer — above every stacking context and reliably
 * interactive in any orientation (portrait and landscape).
 */
const DEFAULT_ASPECT = 'aspect-[5/4] sm:aspect-[16/9] lg:aspect-[21/9]';

export default function EnlargeableChart({
  children, title, subtitle, controls, className, aspect = DEFAULT_ASPECT,
}: EnlargeableChartProps) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    else if (!open && dlg.open) dlg.close();
  }, [open]);

  return (
    <div className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(true); }}
        aria-label="Enlarge chart"
        title="Enlarge"
        className="absolute top-0 right-0 z-10 p-1 rounded text-ink-4 hover:text-ink hover:bg-raised/80 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
        </svg>
      </button>

      {children(false)}

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        onCancel={() => setOpen(false)}
        className="m-0 p-0 max-w-none max-h-none w-screen h-screen bg-page text-ink backdrop:bg-black/80 overflow-hidden"
      >
        {open && (
          <div
            className="flex h-full w-full flex-col"
            style={{
              paddingTop:    'max(1rem, env(safe-area-inset-top))',
              paddingRight:  'max(1rem, env(safe-area-inset-right))',
              paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
              paddingLeft:   'max(1rem, env(safe-area-inset-left))',
            }}
          >
            <div className="shrink-0 flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink truncate">{title ?? 'Chart'}</p>
                {subtitle && <p className="text-xs text-ink-4 mt-0.5">{subtitle}</p>}
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {controls}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close fullscreen"
                  title="Close"
                  className="shrink-0 flex items-center justify-center w-10 h-10 rounded-lg bg-raised text-ink-2 hover:text-ink hover:bg-hover active:bg-hover-2 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            {/* The chart used to be handed the whole remaining viewport
                height — a 160px chart stretched to ~700px, ballooning the
                plot area and flattening the line. Constraining by aspect and
                centring keeps the proportions; max-h-full means the ratio
                gives way before the layout overflows. Call sites still pass
                height="100%" and simply fill this box. */}
            <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
              <div className={`w-full max-h-full ${aspect}`}>
                {children(true)}
              </div>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
