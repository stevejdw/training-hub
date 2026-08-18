'use client';

import type { ReactNode } from 'react';

/** Card panel for desktop grid layouts. min-w-0/min-h-0 are baked in so
 *  Recharts ResponsiveContainer inside a CSS grid cell can shrink with
 *  the panel instead of blowing the track out. */
export default function Panel({
  title,
  controls,
  children,
  className = '',
  bodyClassName = '',
}: {
  title?: string;
  controls?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`bg-surface border border-line rounded-xl min-w-0 min-h-0 flex flex-col ${className}`}>
      {(title || controls) && (
        <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 flex-shrink-0">
          {title && <h2 className="text-xs font-semibold text-ink-4 uppercase tracking-wider">{title}</h2>}
          {controls}
        </div>
      )}
      <div className={`flex-1 min-h-0 px-4 pb-4 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
