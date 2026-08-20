'use client';

import Link from 'next/link';
import type { NextEvent } from '@/components/FeedPage';

/** The event, as a slim full-width bar.
 *
 *  It used to be an 80px sliver at the top of the mobile dashboard showing a
 *  day count in 10px type — prime position, almost no information. Same width
 *  now buys the date, location and goal, and it sits below training state and
 *  today's session rather than above them.
 *
 *  `date`, `goal` and `location` were already in the payload and never shown. */
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

export default function EventCountdownBar({ event }: { event?: NextEvent | null }) {
  if (!event) {
    return (
      <Link
        href="/events"
        className="flex items-center justify-between gap-3 rounded-xl border border-line bg-raised/40 px-3 py-2 hover:border-line-hover transition-colors"
      >
        <span className="text-xs text-ink-4">No upcoming events</span>
        <span className="text-micro text-accent">Add one →</span>
      </Link>
    );
  }

  return (
    <Link
      href={`/events/${event.id}`}
      className="flex items-center gap-3 rounded-xl border border-accent/25 bg-accent/10 px-3 py-2 hover:border-accent/60 transition-colors"
    >
      <div className="flex-shrink-0 text-center leading-none">
        <span className="block text-xl font-black text-accent-hi tabular-nums">{event.daysAway}</span>
        <span className="block text-micro text-accent-hi/70 mt-0.5">days</span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-ink truncate">{event.name}</p>
        <p className="text-micro text-ink-4 truncate mt-0.5">
          {fmtDate(event.date)}
          {event.location ? ` · ${event.location}` : ''}
        </p>
      </div>

      {event.goal && (
        <span className="hidden sm:block flex-shrink-0 max-w-[40%] truncate text-micro text-accent-hi bg-accent/15 rounded px-2 py-1">
          {event.goal}
        </span>
      )}

      <svg className="w-4 h-4 flex-shrink-0 text-ink-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}
