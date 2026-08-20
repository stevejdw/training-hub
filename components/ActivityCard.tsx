'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { sportLabel, sportColor } from '@/lib/sport-types';

/**
 * One ride, as a card.
 *
 * The Activities list rendered a 600px-min-width table on a 375px phone:
 * horizontal scroll, names truncated to "Sydney…", and "20 August 2026"
 * taking a third of the row. The Home feed already had a card that reads
 * properly at that width — this is that card, shared by both, so the two
 * surfaces can't drift apart again.
 *
 * Every metric is optional: the feed payload carries speed, IF and a route
 * polyline that the activities list doesn't select, and vice versa. Anything
 * missing is simply left out rather than rendered as a dash.
 */
export interface ActivityCardRide {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  distance: number;
  moving_time: number;
  total_elevation_gain: number;
  trainer?: boolean;
  average_watts?: number | null;
  normalized_power?: number | null;
  average_heartrate?: number | null;
  average_speed?: number | null;
  intensity_factor?: number | null;
  tss?: number | null;
  power_meter?: string | null;
}

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m}m`;
}

/** "Today", "Yesterday", "Tue 12 Aug" within the year, otherwise with it. */
export function relDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString('en-AU', {
    weekday: days < 7 ? 'short' : undefined,
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}

export default function ActivityCard({
  ride,
  footer,
}: {
  ride: ActivityCardRide;
  /** Optional extra below the metrics — the feed passes a route map. */
  footer?: ReactNode;
}) {
  const color = sportColor(ride.sport_type);
  const np = ride.normalized_power ?? ride.average_watts;
  const speedKph = ride.average_speed ? (ride.average_speed * 3.6).toFixed(1) : null;

  return (
    <Link
      href={`/activities/${ride.id}`}
      className="group block overflow-hidden rounded-2xl border border-line-strong/40 bg-raised/60 transition-colors hover:border-line-hover/60"
    >
      <div className="px-4 pb-3 pt-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <span
                className="flex-shrink-0 rounded px-2 py-0.5 text-micro font-semibold"
                style={{ background: color + '22', color }}
              >
                {sportLabel(ride.sport_type)}{ride.trainer ? ' · Indoor' : ''}
              </span>
              <span className="truncate text-mini text-ink-4">
                {relDate(ride.start_date)} · {timeOfDay(ride.start_date)}
              </span>
            </div>
            {/* Two lines, not one: ride names are routinely longer than a
                phone is wide and the truncated one told you nothing. */}
            <h3 className="line-clamp-2 text-base font-bold leading-tight text-ink transition-colors group-hover:text-accent-hi">
              {ride.name}
            </h3>
          </div>
          <svg className="mt-1 h-4 w-4 flex-shrink-0 text-ink-5 transition-colors group-hover:text-accent-hi" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          {ride.distance > 0 && (
            <span className="font-semibold text-ink">
              {(ride.distance / 1000).toFixed(1)}<span className="ml-0.5 text-xs text-ink-4">km</span>
            </span>
          )}
          {speedKph && <span className="text-ink-3">{speedKph}<span className="ml-0.5 text-xs">km/h</span></span>}
          <span className="text-ink-3">{fmtDuration(ride.moving_time)}</span>
          {ride.total_elevation_gain > 0 && (
            <span className="text-ink-3">{Math.round(ride.total_elevation_gain)}<span className="ml-0.5 text-xs">m</span></span>
          )}
          {np != null && np > 0 && (
            <span className="text-ink-2">{Math.round(np)}<span className="ml-0.5 text-xs text-ink-4">W</span></span>
          )}
          {ride.intensity_factor != null && ride.intensity_factor > 0 && (
            <span className="text-xs text-ink-3">IF {Number(ride.intensity_factor).toFixed(2)}</span>
          )}
          {ride.tss != null && ride.tss > 0 && (
            <span className="text-xs font-medium text-accent-hi">{Math.round(ride.tss)} TSS</span>
          )}
          {ride.average_heartrate != null && ride.average_heartrate > 0 && (
            <span className="text-xs text-red-400">♥ {Math.round(ride.average_heartrate)}</span>
          )}
        </div>
      </div>

      {footer}
    </Link>
  );
}
