'use client';

import { useState } from 'react';
import EventPacingModal from '@/components/EventPacingModal';
import { EventGoal } from '@/lib/profile';
import { fmtTime } from '@/lib/pacing';
import { iconFor } from '@/components/nav-items';
import { PageShell, inputCls, useProfileEdit } from '@/lib/use-profile-edit';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1.5">{label}</label>
      {children}
    </div>
  );
}

export default function EventsContent() {
  const { profile, setProfile, save, saving, saved } = useProfileEdit();
  const [pacingEvent, setPacingEvent] = useState<EventGoal | null>(null);

  if (!profile) {
    return <PageShell title="Events" icon={iconFor("events")}><div className="text-gray-500 text-sm">Loading…</div></PageShell>;
  }

  function addEvent() {
    setProfile(prev => prev ? { ...prev, events: [...prev.events, { name: '', date: '', goal: '' }] } : prev);
  }
  function updateEvent(i: number, field: keyof EventGoal, value: string) {
    setProfile(prev => {
      if (!prev) return prev;
      return { ...prev, events: prev.events.map((e, idx) => idx === i ? { ...e, [field]: value } : e) };
    });
  }
  function removeEvent(i: number) {
    setProfile(prev => prev ? { ...prev, events: prev.events.filter((_, idx) => idx !== i) } : prev);
  }

  return (
    <PageShell title="Events" icon={iconFor("events")}>
      <div className="bg-gray-900 rounded-xl p-5 space-y-3 border border-gray-800">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Upcoming Events</h2>
          <button onClick={addEvent} className="text-sm text-orange-400 hover:text-orange-300 transition-colors">+ Add event</button>
        </div>

        {profile.events.length === 0 && (
          <p className="text-sm text-gray-600 py-1">No events yet. Add one above to set goals and a pacing strategy.</p>
        )}

        <div className="space-y-3">
          {profile.events.map((event, i) => (
            <div key={i} className="border border-gray-800 rounded-xl p-4 space-y-3 relative">
              <button onClick={() => removeEvent(i)} className="absolute top-3 right-3 text-gray-600 hover:text-red-400 transition-colors text-xs px-1">
                ✕ Remove
              </button>
              <div className="grid grid-cols-2 gap-3 pr-16">
                <Field label="Event name">
                  <input type="text" value={event.name} onChange={e => updateEvent(i, 'name', e.target.value)} className={inputCls} placeholder="e.g. Peaks Challenge" />
                </Field>
                <Field label="Date">
                  <input type="date" value={event.date} onChange={e => updateEvent(i, 'date', e.target.value)} className={inputCls} />
                </Field>
              </div>
              <Field label="Goal for this event">
                <input type="text" value={event.goal} onChange={e => updateEvent(i, 'goal', e.target.value)} className={inputCls} placeholder="e.g. Sub 8:30, finish strong, top 10" />
              </Field>

              <div className="flex items-center justify-between pt-1">
                {event.pacing_strategy?.est_time_min ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Pacing:</span>
                    <span className="text-xs font-semibold text-orange-400">{fmtTime(event.pacing_strategy.est_time_min)}</span>
                    {event.route && (
                      <span className="text-xs text-gray-600">
                        · {Math.round(event.route.distance_m / 100) / 10} km
                        · {event.pacing_strategy.climbs.length} climb{event.pacing_strategy.climbs.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-gray-600">No pacing strategy set</span>
                )}
                <button
                  onClick={() => setPacingEvent(event)}
                  className="px-3 py-1 text-xs font-medium rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors border border-gray-700"
                >
                  {event.pacing_strategy ? 'Edit pacing' : 'Set pacing →'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={() => save()} disabled={saving} className="px-6 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-medium transition-colors">
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save events'}
        </button>
      </div>

      {pacingEvent && profile && (
        <EventPacingModal
          event={pacingEvent}
          riderWeightKg={profile.weight_kg ?? 75}
          onSave={updated => {
            setProfile(prev => {
              if (!prev) return prev;
              return { ...prev, events: prev.events.map(e => e.name === pacingEvent.name && e.date === pacingEvent.date ? updated : e) };
            });
            setPacingEvent(null);
            // Auto-save
            const merged = { ...profile, events: profile.events.map(e => e.name === pacingEvent.name && e.date === pacingEvent.date ? updated : e) };
            save(merged);
          }}
          onClose={() => setPacingEvent(null)}
        />
      )}
    </PageShell>
  );
}
