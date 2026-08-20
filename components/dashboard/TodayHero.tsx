'use client';

import Link from 'next/link';
import type { NextSession } from '@/components/FeedPage';

/** "What am I doing today?" — the question a training app should answer the
 *  moment it opens. Next Session was previously a small card at the bottom of
 *  the desktop right rail, and half of a pair on mobile. */
const TYPE_ACCENT: Record<string, string> = {
  recovery:  'var(--chart-pos)',
  endurance: 'var(--chart-hr)',
  tempo:     'var(--chart-warn)',
  threshold: 'var(--chart-power)',
  vo2max:    'var(--chart-neg)',
  race:      'var(--chart-atl)',
};

function whenLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
     new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000,
  );
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 1 && days < 7) return d.toLocaleDateString('en-AU', { weekday: 'long' });
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function TodayHero({ session }: { session: NextSession | null | undefined }) {
  if (!session) {
    return (
      <section className="bg-surface border border-line rounded-2xl px-4 py-3.5">
        <p className="text-micro text-ink-4 uppercase tracking-wider">Next session</p>
        <p className="text-sm text-ink-3 mt-1">
          Nothing scheduled.{' '}
          <Link href="/training?tab=plan" className="text-accent hover:text-accent-hi transition-colors">
            Open your plan
          </Link>
        </p>
      </section>
    );
  }

  const accent = TYPE_ACCENT[session.type ?? ''] ?? 'var(--accent)';

  return (
    <Link
      href="/training?tab=plan"
      className="block bg-surface border border-line rounded-2xl px-4 py-3.5 hover:border-line-hover transition-colors"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-micro uppercase tracking-wider" style={{ color: accent }}>
            {whenLabel(session.date)}{session.type ? ` · ${session.type}` : ''}
          </p>
          <p className="text-base font-semibold text-ink mt-0.5 truncate">{session.title}</p>
          {/* Already fetched; was only ever rendered in the 768–1023 band. */}
          {session.description && (
            <p className="text-xs text-ink-4 mt-1 line-clamp-2 leading-relaxed">{session.description}</p>
          )}
        </div>
        <div className="flex items-center gap-4 flex-shrink-0 text-right">
          {session.duration_min != null && (
            <div>
              <p className="text-micro text-ink-4 uppercase tracking-wider">Duration</p>
              <p className="text-sm font-semibold text-ink tabular-nums">{session.duration_min} min</p>
            </div>
          )}
          {session.tss_target != null && (
            <div>
              <p className="text-micro text-ink-4 uppercase tracking-wider">Target</p>
              <p className="text-sm font-semibold text-ink tabular-nums">{session.tss_target} TSS</p>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
