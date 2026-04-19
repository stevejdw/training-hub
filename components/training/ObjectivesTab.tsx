'use client';

import { useEffect, useState } from 'react';
import { AthleteProfile, EventGoal, PowerTarget } from '@/lib/profile';

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

function formatEventDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function EventCard({ event }: { event: EventGoal }) {
  const days = daysUntil(event.date);
  const past = days < 0;
  return (
    <div className={`flex items-start gap-3 px-4 py-3 ${past ? 'opacity-50' : ''}`}>
      <div className="flex-shrink-0 mt-0.5">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${
          past ? 'bg-gray-800' : days <= 30 ? 'bg-orange-500/20' : 'bg-blue-500/20'
        }`}>
          🏁
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{event.name}</p>
        <p className="text-xs text-gray-400 mt-0.5">{event.goal}</p>
        <p className="text-[11px] text-gray-500 mt-1">
          {formatEventDate(event.date)}
          {!past && (
            <span className={`ml-2 ${days <= 30 ? 'text-orange-400' : 'text-gray-500'}`}>
              {days === 0 ? 'Today!' : days === 1 ? 'Tomorrow' : `${days} days away`}
            </span>
          )}
          {past && <span className="ml-2 text-gray-600">Completed</span>}
        </p>
      </div>
    </div>
  );
}

function PowerTargetCard({ target }: { target: PowerTarget }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex-shrink-0 w-16 text-center">
        <span className="text-lg font-bold text-white">{target.target_watts}</span>
        <span className="text-xs text-gray-400">W</span>
        <div className="text-[10px] text-gray-500 mt-0.5">{target.label}</div>
      </div>
      <div className="flex-1 min-w-0 border-l border-gray-700 pl-3">
        {target.notes ? (
          <p className="text-xs text-gray-300">{target.notes}</p>
        ) : (
          <p className="text-xs text-gray-600">No notes</p>
        )}
      </div>
    </div>
  );
}

const PROFILE_CACHE_KEY = 'cache-profile';

export default function ObjectivesTab() {
  const [profile, setProfile] = useState<AthleteProfile | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const s = localStorage.getItem(PROFILE_CACHE_KEY);
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  });
  const [loading, setLoading] = useState(() => {
    if (typeof window === 'undefined') return true;
    try { return !localStorage.getItem(PROFILE_CACHE_KEY); }
    catch { return true; }
  });
  const [error, setError] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(() => {
    if (typeof window === 'undefined') return '';
    try {
      const s = localStorage.getItem(PROFILE_CACHE_KEY);
      if (s) return (JSON.parse(s) as AthleteProfile).training_notes ?? '';
    } catch {}
    return '';
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); }
        else {
          setProfile(data);
          setNotesValue(data.training_notes ?? '');
          try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(data)); } catch {}
        }
        setLoading(false);
      })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  async function saveNotes() {
    if (!profile) return;
    setSaving(true);
    const updated = { ...profile, training_notes: notesValue };
    try {
      await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      setProfile(updated);
      try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(updated)); } catch {}
      setEditingNotes(false);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map(i => (
          <div key={i} className="bg-gray-800 rounded-xl h-32 animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) return <p className="text-red-400 text-sm">{error}</p>;
  if (!profile) return null;

  const upcomingEvents = [...(profile.events ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const futureEvents = upcomingEvents.filter(e => daysUntil(e.date) >= 0);
  const pastEvents   = upcomingEvents.filter(e => daysUntil(e.date) < 0);

  return (
    <div className="space-y-4">

      {/* Upcoming Events */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Upcoming Events</h3>
        </div>
        <div className="bg-gray-800/60 rounded-xl overflow-hidden divide-y divide-gray-700/50">
          {futureEvents.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-gray-500">No upcoming events</p>
              <p className="text-xs text-gray-600 mt-1">Add events in Settings → Profile</p>
            </div>
          ) : (
            futureEvents.map((e, i) => <EventCard key={i} event={e} />)
          )}
        </div>
        {pastEvents.length > 0 && (
          <div className="mt-2 bg-gray-800/40 rounded-xl overflow-hidden divide-y divide-gray-700/30">
            <div className="px-4 py-1.5">
              <span className="text-[10px] text-gray-600 uppercase tracking-wider">Past</span>
            </div>
            {pastEvents.slice(-3).reverse().map((e, i) => <EventCard key={i} event={e} />)}
          </div>
        )}
      </div>

      {/* Power Targets */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Power Targets</h3>
        </div>
        <div className="bg-gray-800/60 rounded-xl overflow-hidden divide-y divide-gray-700/50">
          {(profile.power_targets ?? []).length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-gray-500">No power targets set</p>
              <p className="text-xs text-gray-600 mt-1">Add targets in Settings → Profile</p>
            </div>
          ) : (
            (profile.power_targets ?? []).map(t => <PowerTargetCard key={t.id} target={t} />)
          )}
        </div>
      </div>

      {/* Training Notes */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Training Notes</h3>
          {!editingNotes && (
            <button
              onClick={() => setEditingNotes(true)}
              className="text-xs text-gray-500 hover:text-white transition-colors"
            >
              Edit
            </button>
          )}
        </div>
        <div className="bg-gray-800/60 rounded-xl overflow-hidden">
          {editingNotes ? (
            <div className="p-3 space-y-2">
              <textarea
                value={notesValue}
                onChange={e => setNotesValue(e.target.value)}
                rows={6}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-orange-500"
                placeholder="Notes on your current training focus, injuries, fatigue, etc."
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { setEditingNotes(false); setNotesValue(profile.training_notes ?? ''); }}
                  className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveNotes}
                  disabled={saving}
                  className="px-3 py-1.5 text-xs bg-orange-500 hover:bg-orange-400 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <div
              className="px-4 py-3 min-h-[60px] cursor-text"
              onClick={() => setEditingNotes(true)}
            >
              {profile.training_notes ? (
                <p className="text-sm text-gray-300 whitespace-pre-wrap">{profile.training_notes}</p>
              ) : (
                <p className="text-sm text-gray-600">Tap to add training notes…</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* FTP summary */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Current Form</h3>
        <div className="bg-gray-800/60 rounded-xl px-4 py-3 flex gap-6">
          <div className="text-center">
            <p className="text-xl font-bold text-white">{profile.use_eftp && profile.eftp ? profile.eftp : profile.ftp}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">{profile.use_eftp && profile.eftp ? 'eFTP' : 'FTP'} (W)</p>
          </div>
          {profile.weight_kg && (
            <div className="text-center border-l border-gray-700 pl-6">
              <p className="text-xl font-bold text-white">
                {((profile.use_eftp && profile.eftp ? profile.eftp : profile.ftp) / profile.weight_kg).toFixed(2)}
              </p>
              <p className="text-[10px] text-gray-500 mt-0.5">W/kg</p>
            </div>
          )}
          {profile.max_hr && (
            <div className="text-center border-l border-gray-700 pl-6">
              <p className="text-xl font-bold text-white">{profile.max_hr}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">Max HR</p>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
