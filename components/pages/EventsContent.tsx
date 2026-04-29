'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EventGoal } from '@/lib/profile';
import { fmtTime } from '@/lib/pacing';
import { iconFor } from '@/components/nav-items';
import PageHeader from '@/components/PageHeader';
import { useProfileEdit } from '@/lib/use-profile-edit';

function daysToGo(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d     = new Date(dateStr + 'T00:00:00'); d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return '';
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [, m, d] = dateStr.split('-').map(Number);
  return `${d} ${M[m - 1]}`;
}

function EventCard({ event }: { event: EventGoal }) {
  const days  = event.date ? daysToGo(event.date) : null;
  const past  = days !== null && days < 0;
  const today = days === 0;
  const route = event.route;

  const daysLabel = days === null ? null
    : today        ? 'Today!'
    : days === 1   ? 'Tomorrow'
    : days > 0     ? `${days} days to go`
    : `${Math.abs(days)} days ago`;

  const daysColor = today ? 'text-orange-400 font-bold'
    : days !== null && days <= 7 && days > 0 ? 'text-yellow-400'
    : past                                    ? 'text-gray-600'
    : 'text-green-400';

  return (
    <Link
      href={`/events/${event.id ?? ''}`}
      className={`block bg-gray-900 border rounded-2xl overflow-hidden transition-colors hover:border-gray-700 active:bg-gray-800/60 ${
        past ? 'border-gray-800/60 opacity-60' : 'border-gray-800'
      }`}
    >
      {/* Top bar: days to go */}
      {daysLabel && (
        <div className={`flex items-center justify-end px-4 pt-3 text-[11px] font-semibold uppercase tracking-wider ${daysColor}`}>
          {daysLabel}
        </div>
      )}

      <div className="px-4 pb-4 pt-2 space-y-2">
        {/* Name + date */}
        <div>
          <h3 className="text-lg font-bold text-white leading-tight">{event.name || 'Unnamed event'}</h3>
          <div className="flex items-center gap-3 mt-0.5">
            {event.date && (
              <span className="text-sm text-gray-400">{fmtDate(event.date)}</span>
            )}
            {event.location && (
              <span className="flex items-center gap-1 text-sm text-gray-500">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {event.location}
              </span>
            )}
          </div>
        </div>

        {/* Goal */}
        {event.goal && (
          <p className="text-sm text-gray-400 leading-snug">
            <span className="text-gray-600 text-xs uppercase tracking-wider mr-1.5">Goal</span>
            {event.goal}
          </p>
        )}

        {/* Route stats */}
        {route && (
          <div className="flex items-center gap-4 pt-1">
            <span className="flex items-center gap-1.5 text-xs text-gray-400">
              <svg className="w-3.5 h-3.5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 13l4.553 2.276A1 1 0 0021 21.382V10.618a1 1 0 00-.553-.894L15 7m0 13V7m0 0L9 4" />
              </svg>
              {Math.round(route.distance_m / 100) / 10} km
            </span>
            <span className="flex items-center gap-1.5 text-xs text-gray-400">
              <svg className="w-3.5 h-3.5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 21l9-9 4 4 5-7" />
              </svg>
              {Math.round(route.elevation_gain)} m
            </span>
            {event.pacing_strategy?.est_time_min ? (
              <span className="flex items-center gap-1.5 text-xs text-orange-400 font-medium">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="9" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
                </svg>
                {fmtTime(event.pacing_strategy.est_time_min)}
              </span>
            ) : (
              <span className="text-xs text-gray-600">No pacing set</span>
            )}
          </div>
        )}

        {/* Chevron */}
        <div className="flex justify-end">
          <svg className="w-4 h-4 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </Link>
  );
}

export default function EventsContent() {
  const router = useRouter();
  const { profile, setProfile, save } = useProfileEdit();
  const [adding, setAdding] = useState(false);

  if (!profile) {
    return (
      <div className="h-full flex flex-col">
        <PageHeader icon={iconFor('events')} title="Events" />
        <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">Loading…</div>
      </div>
    );
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const upcoming = profile.events
    .filter(e => !e.date || new Date(e.date + 'T00:00:00') >= today)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const past = profile.events
    .filter(e => e.date && new Date(e.date + 'T00:00:00') < today)
    .sort((a, b) => b.date.localeCompare(a.date));

  function addEvent() {
    const newId = Date.now().toString(36);
    const blank: EventGoal = { id: newId, name: '', date: '', goal: '', location: '' };
    const updated = { ...profile!, events: [...profile!.events, blank] };
    setProfile(updated);
    save(updated);
    router.push(`/events/${newId}`);
  }

  const plusBtn = (
    <button
      onClick={addEvent}
      aria-label="Add event"
      className="w-8 h-8 flex items-center justify-center rounded-full bg-orange-500 hover:bg-orange-400 text-white transition-colors"
    >
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
      </svg>
    </button>
  );

  return (
    <div className="h-full flex flex-col">
      <PageHeader icon={iconFor('events')} title="Events" right={plusBtn} />

      <div className="flex-1 overflow-y-auto scroll-touch">
        <div className="max-w-2xl mx-auto px-4 py-4 md:px-8 md:py-8 space-y-6">

          {/* Upcoming */}
          {upcoming.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 px-0.5">Upcoming</h2>
              {upcoming.map((e, i) => <EventCard key={e.id ?? i} event={e} />)}
            </section>
          ) : (
            <div className="bg-gray-900 border border-gray-800 border-dashed rounded-2xl p-10 text-center space-y-2">
              <p className="text-gray-400 text-sm">No upcoming events.</p>
              <p className="text-gray-600 text-xs">Tap + to add your first event.</p>
            </div>
          )}

          {/* Past */}
          {past.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 px-0.5">Past</h2>
              {past.map((e, i) => <EventCard key={e.id ?? i} event={e} />)}
            </section>
          )}

          <div className="h-20" />
        </div>
      </div>

      {/* Hidden — keeps unused import from erroring */}
      {adding && <span className="hidden">{String(adding)}</span>}
    </div>
  );
}
