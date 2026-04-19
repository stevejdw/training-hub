'use client';

import { useEffect, useState } from 'react';
import TrainingPlansSettings from './training/TrainingPlansSettings';
import EventPacingModal from './EventPacingModal';
import { AthleteProfile, EventGoal } from '@/lib/profile';
import { type ThemePreference, getThemePreference, setThemePreference } from './ThemeProvider';
import { fmtTime } from '@/lib/pacing';

const TIMEZONES = [
  { label: 'Sydney / Melbourne (AEST/AEDT)',  value: 'Australia/Sydney'    },
  { label: 'Brisbane (AEST)',                  value: 'Australia/Brisbane'  },
  { label: 'Adelaide (ACST/ACDT)',             value: 'Australia/Adelaide'  },
  { label: 'Perth (AWST)',                     value: 'Australia/Perth'     },
  { label: 'Darwin (ACST)',                    value: 'Australia/Darwin'    },
  { label: 'Auckland (NZST/NZDT)',             value: 'Pacific/Auckland'    },
  { label: 'London (GMT/BST)',                 value: 'Europe/London'       },
  { label: 'Paris / Berlin (CET/CEST)',        value: 'Europe/Paris'        },
  { label: 'New York (EST/EDT)',               value: 'America/New_York'    },
  { label: 'Los Angeles (PST/PDT)',            value: 'America/Los_Angeles' },
  { label: 'Denver (MST/MDT)',                 value: 'America/Denver'      },
  { label: 'Chicago (CST/CDT)',                value: 'America/Chicago'     },
  { label: 'UTC',                              value: 'UTC'                 },
];

interface EftpEstimate {
  duration_label: string;
  best_watts:     number;
  multiplier:     number;
  eftp:           number;
}

interface EftpData {
  estimates:     EftpEstimate[];
  best_eftp:     number | null;
  best_duration: string | null;
}

type SettingsTab = 'profile' | 'plans' | 'events';

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'profile', label: 'Profile'         },
  { key: 'plans',   label: 'Training Plans'  },
  { key: 'events',  label: 'Events & Goals'  },
];

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1.5">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-600 mt-1">{hint}</p>}
    </div>
  );
}

const inputCls = 'w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-colors';

export default function ProfileEditor() {
  const [tab,      setTab]      = useState<SettingsTab>('profile');
  const [profile,  setProfile]  = useState<AthleteProfile | null>(null);
  const [eftpData, setEftpData] = useState<EftpData | null>(null);
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(false);
  const [theme,        setTheme]        = useState<ThemePreference>('dark');
  const [pacingEvent,  setPacingEvent]  = useState<EventGoal | null>(null);

  useEffect(() => {
    fetch('/api/profile').then(r => r.json()).then(setProfile);
    fetch('/api/profile/eftp-options').then(r => r.json()).then(setEftpData);
    setTheme(getThemePreference());
  }, []);

  function changeTheme(t: ThemePreference) {
    setTheme(t);
    setThemePreference(t);
  }

  function update<K extends keyof AthleteProfile>(key: K, value: AthleteProfile[K]) {
    setProfile(prev => prev ? { ...prev, [key]: value } : prev);
  }

  // Goals
  function addGoal() {
    setProfile(prev => prev ? { ...prev, goals: [...(prev.goals ?? []), ''] } : prev);
  }
  function updateGoal(i: number, value: string) {
    setProfile(prev => {
      if (!prev) return prev;
      const goals = (prev.goals ?? []).map((g, idx) => idx === i ? value : g);
      return { ...prev, goals };
    });
  }
  function removeGoal(i: number) {
    setProfile(prev => prev ? { ...prev, goals: (prev.goals ?? []).filter((_, idx) => idx !== i) } : prev);
  }

  // Events
  function addEvent() {
    setProfile(prev => prev ? { ...prev, events: [...prev.events, { name: '', date: '', goal: '' }] } : prev);
  }
  function updateEvent(i: number, field: keyof EventGoal, value: string) {
    setProfile(prev => {
      if (!prev) return prev;
      const events = prev.events.map((e, idx) => idx === i ? { ...e, [field]: value } : e);
      return { ...prev, events };
    });
  }
  function removeEvent(i: number) {
    setProfile(prev => prev ? { ...prev, events: prev.events.filter((_, idx) => idx !== i) } : prev);
  }

  async function save() {
    if (!profile) return;
    setSaving(true);
    await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (!profile) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-shrink-0 h-12 border-b border-gray-800" />
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading…</div>
      </div>
    );
  }

  const displayFtp = profile.use_eftp && profile.eftp ? profile.eftp : profile.ftp;
  const goals = profile.goals ?? [];

  return (
    <div className="h-full flex flex-col">

      {/* Tab bar */}
      <div className="flex-shrink-0 flex border-b border-gray-800 overflow-x-auto">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors -mb-px ${
              tab === key
                ? 'border-orange-500 text-white'
                : 'border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto scroll-touch">
        <div className="max-w-2xl mx-auto px-4 pt-4 pb-10 space-y-5">

          {/* ── PROFILE TAB ── */}
          {tab === 'profile' && (
            <>
              {/* Appearance */}
              <div className="bg-gray-900 rounded-xl p-5 space-y-3 border border-gray-800">
                <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Appearance</h2>
                <div className="grid grid-cols-3 gap-2">
                  {/* Dark */}
                  <button
                    onClick={() => changeTheme('dark')}
                    className={`rounded-xl p-3 border-2 transition-colors text-left ${theme === 'dark' ? 'border-orange-500' : 'border-gray-700 hover:border-gray-600'}`}
                  >
                    <div className="flex gap-1 mb-2">
                      <div className="w-4 h-4 rounded bg-gray-950 border border-gray-700" />
                      <div className="w-4 h-4 rounded bg-gray-800 border border-gray-700" />
                      <div className="w-4 h-4 rounded bg-gray-700 border border-gray-700" />
                    </div>
                    <p className="text-xs font-semibold text-gray-200">Dark</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">Always dark</p>
                  </button>

                  {/* Auto */}
                  <button
                    onClick={() => changeTheme('auto')}
                    className={`rounded-xl p-3 border-2 transition-colors text-left ${theme === 'auto' ? 'border-orange-500' : 'border-gray-700 hover:border-gray-600'}`}
                  >
                    <div className="flex gap-1 mb-2">
                      <div className="w-4 h-4 rounded" style={{ background: 'linear-gradient(135deg, #030712 50%, #f8fafc 50%)' }} />
                      <div className="w-4 h-4 rounded bg-orange-500/30 border border-orange-500/50" />
                    </div>
                    <p className="text-xs font-semibold text-gray-200">Auto</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">7am–7pm light</p>
                  </button>

                  {/* Light */}
                  <button
                    onClick={() => changeTheme('light')}
                    className={`rounded-xl p-3 border-2 transition-colors text-left ${theme === 'light' ? 'border-orange-500' : 'border-gray-700 hover:border-gray-600'}`}
                  >
                    <div className="flex gap-1 mb-2">
                      <div className="w-4 h-4 rounded bg-white border border-gray-300" />
                      <div className="w-4 h-4 rounded bg-slate-100 border border-gray-300" />
                      <div className="w-4 h-4 rounded bg-slate-200 border border-gray-300" />
                    </div>
                    <p className="text-xs font-semibold text-gray-200">Light</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">Always light</p>
                  </button>
                </div>
              </div>

              {/* Basic info */}
              <div className="bg-gray-900 rounded-xl p-5 space-y-4 border border-gray-800">
                <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Basic Info</h2>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Name">
                    <input
                      type="text"
                      value={profile.name}
                      onChange={e => update('name', e.target.value)}
                      className={inputCls}
                      placeholder="Your name"
                    />
                  </Field>
                  <Field label="Weight (kg)" hint="Used for w/kg calculations">
                    <input
                      type="number"
                      value={profile.weight_kg ?? ''}
                      onChange={e => update('weight_kg', e.target.value ? Number(e.target.value) : null)}
                      className={inputCls}
                      placeholder="e.g. 75"
                      min={30}
                      max={200}
                      step={0.1}
                    />
                  </Field>
                </div>
                <Field label="Timezone" hint="Used for weekly summaries and date calculations">
                  <select
                    value={profile.timezone ?? 'Australia/Sydney'}
                    onChange={e => update('timezone', e.target.value)}
                    className={inputCls}
                  >
                    {TIMEZONES.map(tz => (
                      <option key={tz.value} value={tz.value}>{tz.label}</option>
                    ))}
                  </select>
                </Field>
              </div>

              {/* FTP */}
              <div className="bg-gray-900 rounded-xl p-5 space-y-4 border border-gray-800">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Power — FTP</h2>
                  <span className="text-orange-400 font-bold text-lg">{displayFtp}W active</span>
                </div>

                <Field label="Manual FTP">
                  <input
                    type="number"
                    value={profile.ftp}
                    onChange={e => update('ftp', Number(e.target.value))}
                    className={inputCls}
                    min={100}
                    max={600}
                  />
                </Field>

                <Field label="Use eFTP instead of manual FTP">
                  <div className="flex items-center gap-3 mt-1">
                    <button
                      onClick={() => update('use_eftp', !profile.use_eftp)}
                      className={`relative w-10 h-5 rounded-full transition-colors ${profile.use_eftp ? 'bg-orange-500' : 'bg-gray-700'}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${profile.use_eftp ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                    <span className="text-sm text-gray-400">{profile.use_eftp ? 'Using eFTP' : 'Using manual FTP'}</span>
                  </div>
                </Field>

                {profile.use_eftp && (
                  <Field label="eFTP — estimated from best power (last 14 days)">
                    <div className="space-y-3 mt-1">
                      {eftpData && eftpData.best_eftp ? (
                        <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-lg font-bold text-white">{eftpData.best_eftp}<span className="text-sm font-normal text-gray-400 ml-1">W</span></p>
                              <p className="text-xs text-gray-500">Best estimate · from {eftpData.best_duration} best power</p>
                            </div>
                            <button
                              onClick={() => update('eftp', eftpData.best_eftp)}
                              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                profile.eftp === eftpData.best_eftp
                                  ? 'bg-orange-500 text-white'
                                  : 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30'
                              }`}
                            >
                              {profile.eftp === eftpData.best_eftp ? 'Applied' : 'Use this'}
                            </button>
                          </div>
                          <div className="border-t border-orange-500/20 pt-2 space-y-1">
                            {eftpData.estimates.map(e => (
                              <div key={e.duration_label} className="flex items-center justify-between text-xs">
                                <span className="text-gray-500">{e.duration_label} best</span>
                                <span className="text-gray-400 tabular-nums">
                                  {e.best_watts}W × {(e.multiplier * 100).toFixed(0)}% = {' '}
                                  <span className={e.eftp === eftpData.best_eftp ? 'text-orange-400 font-semibold' : 'text-gray-300'}>
                                    {e.eftp}W
                                  </span>
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-600 py-1">No power stream data in the last 14 days</p>
                      )}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 flex-shrink-0">Override manually:</span>
                        <input
                          type="number"
                          value={profile.eftp ?? ''}
                          onChange={e => update('eftp', e.target.value ? Number(e.target.value) : null)}
                          className="w-24 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-orange-500"
                          placeholder="W"
                          min={100}
                          max={600}
                        />
                        {profile.eftp && eftpData?.best_eftp && profile.eftp !== eftpData.best_eftp && (
                          <span className="text-xs text-gray-600">Current: {profile.eftp}W</span>
                        )}
                      </div>
                    </div>
                  </Field>
                )}
              </div>

              {/* Zone Settings */}
              <div className="bg-gray-900 rounded-xl p-5 space-y-5 border border-gray-800">
                <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Zone Settings</h2>

                {/* HR Zones */}
                <div className="space-y-3">
                  <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">Heart Rate Zones</h3>
                  <Field label="Max HR (bpm)" hint="Required to calculate HR zones">
                    <input
                      type="number"
                      value={profile.max_hr ?? ''}
                      onChange={e => update('max_hr', e.target.value ? Number(e.target.value) : null)}
                      className={inputCls}
                      placeholder="e.g. 185"
                      min={100}
                      max={230}
                    />
                  </Field>
                  <Field label="HR zone calculation">
                    <div className="flex items-center gap-3 mt-1">
                      <button
                        onClick={() => update('hr_zones_auto', !profile.hr_zones_auto)}
                        className={`relative w-10 h-5 rounded-full transition-colors ${profile.hr_zones_auto ? 'bg-orange-500' : 'bg-gray-700'}`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${profile.hr_zones_auto ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </button>
                      <span className="text-sm text-gray-400">{profile.hr_zones_auto ? 'Auto (% of Max HR)' : 'Manual boundaries'}</span>
                    </div>
                  </Field>
                  {!profile.hr_zones_auto && (
                    <Field label="HR zone upper boundaries (bpm)" hint="Upper boundary for Z1–Z4. Z5 is above Z4.">
                      <div className="grid grid-cols-4 gap-2">
                        {['Z1 max', 'Z2 max', 'Z3 max', 'Z4 max'].map((label, i) => (
                          <div key={i}>
                            <div className="text-xs text-gray-600 mb-1">{label}</div>
                            <input
                              type="number"
                              value={profile.hr_zone_boundaries?.[i] ?? ''}
                              onChange={e => {
                                const b = [...(profile.hr_zone_boundaries ?? [0, 0, 0, 0])];
                                b[i] = Number(e.target.value);
                                update('hr_zone_boundaries', b);
                              }}
                              className={inputCls}
                              placeholder="bpm"
                              min={80}
                              max={230}
                            />
                          </div>
                        ))}
                      </div>
                    </Field>
                  )}
                </div>

                {/* Power Zones */}
                <div className="space-y-3 pt-2 border-t border-gray-800">
                  <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">Power Zones</h3>
                  <Field label="Power zone calculation">
                    <div className="flex items-center gap-3 mt-1">
                      <button
                        onClick={() => update('power_zones_auto', !profile.power_zones_auto)}
                        className={`relative w-10 h-5 rounded-full transition-colors ${profile.power_zones_auto ? 'bg-orange-500' : 'bg-gray-700'}`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${profile.power_zones_auto ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </button>
                      <span className="text-sm text-gray-400">{profile.power_zones_auto ? 'Auto (% of FTP)' : 'Manual boundaries'}</span>
                    </div>
                  </Field>
                  {!profile.power_zones_auto && (
                    <Field label="Power zone upper boundaries (W)" hint="Upper boundary for Z1–Z4. Z5 is above Z4.">
                      <div className="grid grid-cols-4 gap-2">
                        {['Z1 max', 'Z2 max', 'Z3 max', 'Z4 max'].map((label, i) => (
                          <div key={i}>
                            <div className="text-xs text-gray-600 mb-1">{label}</div>
                            <input
                              type="number"
                              value={profile.power_zone_boundaries?.[i] ?? ''}
                              onChange={e => {
                                const b = [...(profile.power_zone_boundaries ?? [0, 0, 0, 0])];
                                b[i] = Number(e.target.value);
                                update('power_zone_boundaries', b);
                              }}
                              className={inputCls}
                              placeholder="W"
                              min={50}
                              max={1000}
                            />
                          </div>
                        ))}
                      </div>
                    </Field>
                  )}
                </div>
              </div>

              {/* Save */}
              <div className="flex justify-end">
                <button onClick={save} disabled={saving} className="px-6 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                  {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save profile'}
                </button>
              </div>
            </>
          )}

          {/* ── TRAINING PLANS TAB ── */}
          {tab === 'plans' && <TrainingPlansSettings />}

          {/* ── EVENTS & GOALS TAB ── */}
          {tab === 'events' && (
            <>
              {/* Goals */}
              <div className="bg-gray-900 rounded-xl p-5 space-y-3 border border-gray-800">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Training Goals</h2>
                  <button onClick={addGoal} className="text-sm text-orange-400 hover:text-orange-300 transition-colors">
                    + Add goal
                  </button>
                </div>

                {goals.length === 0 && (
                  <p className="text-sm text-gray-600 py-1">No goals added yet. Goals are used by Coach AI when generating training plans.</p>
                )}

                <div className="space-y-2">
                  {goals.map((goal, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={goal}
                        onChange={e => updateGoal(i, e.target.value)}
                        className={inputCls}
                        placeholder="e.g. Complete 3×10 min @ 340W, Improve climbing w/kg, Sub 8:30 at Peaks"
                      />
                      <button
                        onClick={() => removeGoal(i)}
                        className="flex-shrink-0 text-gray-600 hover:text-red-400 transition-colors px-2 py-1 text-xs"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Events */}
              <div className="bg-gray-900 rounded-xl p-5 space-y-3 border border-gray-800">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Events</h2>
                  <button onClick={addEvent} className="text-sm text-orange-400 hover:text-orange-300 transition-colors">
                    + Add event
                  </button>
                </div>

                {profile.events.length === 0 && (
                  <p className="text-sm text-gray-600 py-1">No events added yet.</p>
                )}

                <div className="space-y-3">
                  {profile.events.map((event, i) => (
                    <div key={i} className="border border-gray-800 rounded-xl p-4 space-y-3 relative">
                      <button
                        onClick={() => removeEvent(i)}
                        className="absolute top-3 right-3 text-gray-600 hover:text-red-400 transition-colors text-xs px-1"
                      >
                        ✕ Remove
                      </button>
                      <div className="grid grid-cols-2 gap-3 pr-16">
                        <Field label="Event name">
                          <input
                            type="text"
                            value={event.name}
                            onChange={e => updateEvent(i, 'name', e.target.value)}
                            className={inputCls}
                            placeholder="e.g. Peaks Challenge"
                          />
                        </Field>
                        <Field label="Date">
                          <input
                            type="date"
                            value={event.date}
                            onChange={e => updateEvent(i, 'date', e.target.value)}
                            className={inputCls}
                          />
                        </Field>
                      </div>
                      <Field label="Goal for this event">
                        <input
                          type="text"
                          value={event.goal}
                          onChange={e => updateEvent(i, 'goal', e.target.value)}
                          className={inputCls}
                          placeholder="e.g. Sub 8:30, finish strong, top 10"
                        />
                      </Field>

                      {/* Pacing strategy summary / button */}
                      <div className="flex items-center justify-between pt-1">
                        {event.pacing_strategy?.est_time_min ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">Pacing:</span>
                            <span className="text-xs font-semibold text-orange-400">
                              {fmtTime(event.pacing_strategy.est_time_min)}
                            </span>
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

              {/* Save */}
              <div className="flex justify-end">
                <button onClick={save} disabled={saving} className="px-6 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                  {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
                </button>
              </div>
            </>
          )}

        </div>
      </div>

      {/* Pacing modal — full screen overlay */}
      {pacingEvent && profile && (
        <EventPacingModal
          event={pacingEvent}
          riderWeightKg={profile.weight_kg ?? 75}
          onSave={updated => {
            // Persist updated event back into profile state
            setProfile(prev => {
              if (!prev) return prev;
              const events = prev.events.map(e =>
                e.name === pacingEvent.name && e.date === pacingEvent.date ? updated : e
              );
              return { ...prev, events };
            });
            setPacingEvent(null);
            // Auto-save
            if (profile) {
              const merged = {
                ...profile,
                events: profile.events.map(e =>
                  e.name === pacingEvent.name && e.date === pacingEvent.date ? updated : e
                ),
              };
              fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(merged) });
            }
          }}
          onClose={() => setPacingEvent(null)}
        />
      )}
    </div>
  );
}
