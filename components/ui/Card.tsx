'use client';

import type { ReactNode } from 'react';

/** The app's card surface.
 *
 *  This shape was duplicated ~70 times across four different recipes
 *  (rounded-lg/xl/2xl × border-line/line-strong). `variant="panel"` is byte
 *  -equivalent to the old desktop/Panel, which now re-exports this.
 *
 *  min-w-0/min-h-0 are baked in so a Recharts ResponsiveContainer inside a
 *  grid cell can shrink with the card instead of blowing the track out. */
export type CardVariant = 'panel' | 'flat';

export default function Card({
  title,
  controls,
  children,
  variant = 'panel',
  className = '',
  bodyClassName = '',
  padded = true,
}: {
  title?: string;
  controls?: ReactNode;
  children: ReactNode;
  variant?: CardVariant;
  className?: string;
  bodyClassName?: string;
  padded?: boolean;
}) {
  const base =
    variant === 'flat'
      ? 'bg-raised border border-line rounded-xl'
      : 'bg-surface border border-line rounded-xl';

  const hasHeader = Boolean(title || controls);

  return (
    <section className={`${base} min-w-0 min-h-0 flex flex-col ${className}`}>
      {hasHeader && (
        <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 flex-shrink-0">
          {title && (
            <h2 className="text-xs font-semibold text-ink-4 uppercase tracking-wider">{title}</h2>
          )}
          {controls}
        </div>
      )}
      <div className={`flex-1 min-h-0 ${padded ? (hasHeader ? 'px-4 pb-4' : 'p-4') : ''} ${bodyClassName}`}>
        {children}
      </div>
    </section>
  );
}
