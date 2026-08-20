'use client';

import type { ReactNode } from 'react';

/** Shared primitives for the Settings screens.
 *
 *  Settings used to be nine `bg-surface rounded-xl p-5` cards, each opening
 *  with an uppercase `<h2>` that repeated the tab it was already sitting
 *  under. One card per section, one heading per screen, and the heading comes
 *  from the page title — so nothing is said twice. */

/** A grouped list, iOS-style: full-bleed on mobile, a card from `sm` up. */
export function Group({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      {title && (
        <h2 className="px-1 text-micro font-semibold uppercase tracking-wider text-ink-4">{title}</h2>
      )}
      <div className="overflow-hidden rounded-xl border border-line bg-surface divide-y divide-line">
        {children}
      </div>
      {footer && <p className="px-1 text-micro leading-relaxed text-ink-4">{footer}</p>}
    </section>
  );
}

/** A tappable row that drills into a sub-screen, with the current value on
 *  the right. The value is the point: the hub answers "what is this set to?"
 *  without making you open five screens to find out. */
export function DrillRow({
  icon,
  label,
  value,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-raised/40 active:bg-raised/60"
    >
      <span className="flex-shrink-0 text-accent-hi [&_svg]:h-5 [&_svg]:w-5">{icon}</span>
      <span className="flex-1 text-base font-medium text-ink">{label}</span>
      {value && <span className="max-w-[45%] truncate text-sm text-ink-4">{value}</span>}
      <svg className="h-5 w-5 flex-shrink-0 text-ink-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

/** A plain (non-drilling) row wrapper for controls that live inline. */
export function Row({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`px-4 py-3.5 ${className}`}>{children}</div>;
}

/** Label + hint + control, stacked. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5 px-4 py-3.5">
      <label className="block text-sm font-medium text-ink-2">{label}</label>
      {hint && <p className="text-micro leading-relaxed text-ink-4">{hint}</p>}
      {children}
    </div>
  );
}

export const inputCls =
  'w-full rounded-lg border border-line-strong bg-raised px-3 py-2.5 text-sm text-ink focus:border-accent focus:outline-none';

/** Small pill used for the preset shortcuts under the coaching textareas. */
export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1 text-micro transition-colors ${
        active
          ? 'border-accent bg-accent/10 text-accent-hi'
          : 'border-line-strong text-ink-4 hover:border-line-hover'
      }`}
    >
      {children}
    </button>
  );
}

/** Busy-state button used by every sync/import action. Replaces four
 *  copies of the same spinner markup. */
export function ActionButton({
  onClick,
  busy,
  disabled,
  busyLabel = 'Working…',
  variant = 'default',
  children,
}: {
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  busyLabel?: string;
  variant?: 'default' | 'accent';
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${
        variant === 'accent'
          ? 'border border-accent/30 bg-accent/10 text-accent-hi hover:bg-accent/20'
          : 'bg-hover text-ink hover:bg-hover-2'
      }`}
    >
      {busy && (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="10" strokeOpacity={0.25} />
          <path d="M12 2a10 10 0 0 1 10 10" />
        </svg>
      )}
      {busy ? busyLabel : children}
    </button>
  );
}

/** Output from a sync/import run. */
export function Log({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg bg-page p-3">
      {lines.map((line, i) => (
        <p key={i} className="font-mono text-mini text-ink-3">{line}</p>
      ))}
    </div>
  );
}

/** Stored / newest / oldest triptych, shared by the Strava and
 *  intervals.icu panels. */
export function StatTriptych({ stats }: { stats: { label: string; value: string }[] }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {stats.map(s => (
        <div key={s.label} className="rounded-lg bg-raised p-2.5 text-center">
          <p className="text-micro uppercase tracking-wider text-ink-4">{s.label}</p>
          <p className="mt-0.5 text-mini font-semibold text-ink">{s.value}</p>
        </div>
      ))}
    </div>
  );
}
