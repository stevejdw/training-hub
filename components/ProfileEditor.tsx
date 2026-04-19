'use client';

import { useEffect, useState } from 'react';
import TrainingPlansSettings from './training/TrainingPlansSettings';

interface EventGoal {
  name: string;
  date: string;
  goal: string;
}

interface AthleteProfile {
  name: string;
  ftp: number;
  use_eftp: boolean;
  eftp: number | null;
  weight_kg: number | null;
  training_goals: string;
  events: EventGoal[];
  timezone: string;
  max_hr: number | null;
  hr_zones_auto: boolean;
  hr_zone_boundaries: number[] | null;
  power_zones_auto: boolean;
  power_zone_boundaries: number[] | null;
}

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

interface EftpOption {
  name: string;
  date: string;
  duration_min: number;
  np: number;
  eftp_estimate: number;
}

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
  const [profile, setProfile] = useState<AthleteProfile | null>(null);
  const [eftpOptions, setEftpOptions] = useState<EftpOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/profile').then(r => r.json()).then(setProfile);
    fetch('/api/profile/eftp-options').then(r => r.json()).then(setEftpOptions);
  }, []);

  function update<K extends keyof AthleteProfile>(key: K, value: AthleteProfile[K]) {
    setProfile(prev => prev ? { ...prev, [key]: value } : prev);
  }

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
    return <div className="flex items-center justify-center h-40 text-gray-500 text-sm">Loading profile…</div>;
  }

  const displayFtp = profile.use_eftp && profile.eftp ? profile.eftp : profile.ftp;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Athlete Profile</h1>
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </button>
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
          <Field label="Select eFTP from recent rides" hint="NP × 0.95 for 18–25 min efforts; raw NP for longer rides">
            <div className="space-y-2 mt-1">
              {eftpOptions.length === 0 && (
                <p className="text-sm text-gray-600">No eligible rides in the last 90 days</p>
              )}
              {eftpOptions.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => update('eftp', Number(opt.eftp_estimate))}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition-colors ${
                    profile.eftp === Number(opt.eftp_estimate)
                      ? 'border-orange-500 bg-orange-500/10 text-white'
                      : 'border-gray-700 hover:border-gray-600 text-gray-300'
                  }`}
                >
                  <span className="truncate text-left">{opt.name} <span className="text-gray-500">({opt.date})</span></span>
                  <span className="flex gap-3 flex-shrink-0 ml-3">
                    <span className="text-gray-500">{opt.duration_min} min</span>
                    <span className="text-gray-400">NP {opt.np}W</span>
                    <span className="text-orange-400 font-medium">→ {opt.eftp_estimate}W</span>
                  </span>
                </button>
              ))}
              <div className="flex items-center gap-2 pt-1">
                <span className="text-xs text-gray-500">Or enter manually:</span>
                <input
                  type="number"
                  value={profile.eftp ?? ''}
                  onChange={e => update('eftp', e.target.value ? Number(e.target.value) : null)}
                  className="w-24 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-orange-500"
                  placeholder="W"
                  min={100}
                  max={600}
                />
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
            <Field label="HR zone upper boundaries (bpm)" hint="Enter the upper boundary for Z1, Z2, Z3, Z4. Z5 is anything above Z4.">
              <div className="grid grid-cols-4 gap-2">
                {['Z1 max', 'Z2 max', 'Z3 max', 'Z4 max'].map((label, i) => (
                  <div key={i}>
                    <div className="text-xs text-gray-600 mb-1">{label}</div>
                    <input
                      type="number"
                      value={profile.hr_zone_boundaries?.[i] ?? ''}
                      onChange={e => {
                        const boundaries = [...(profile.hr_zone_boundaries ?? [0, 0, 0, 0])];
                        boundaries[i] = Number(e.target.value);
                        update('hr_zone_boundaries', boundaries);
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
            <Field label="Power zone upper boundaries (W)" hint="Enter the upper boundary for Z1, Z2, Z3, Z4. Z5 is anything above Z4.">
              <div className="grid grid-cols-4 gap-2">
                {['Z1 max', 'Z2 max', 'Z3 max', 'Z4 max'].map((label, i) => (
                  <div key={i}>
                    <div className="text-xs text-gray-600 mb-1">{label}</div>
                    <input
                      type="number"
                      value={profile.power_zone_boundaries?.[i] ?? ''}
                      onChange={e => {
                        const boundaries = [...(profile.power_zone_boundaries ?? [0, 0, 0, 0])];
                        boundaries[i] = Number(e.target.value);
                        update('power_zone_boundaries', boundaries);
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

      {/* Training goals */}
      <div className="bg-gray-900 rounded-xl p-5 space-y-4 border border-gray-800">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Training Goals</h2>
        <Field label="Current training focus" hint="Describe your training priorities, limiters, and what you're working on">
          <textarea
            value={profile.training_goals}
            onChange={e => update('training_goals', e.target.value)}
            rows={4}
            className={inputCls + ' resize-none'}
            placeholder="e.g. Building base fitness for long events, improving climbing, reducing body weight…"
          />
        </Field>
      </div>

      {/* Events */}
      <div className="bg-gray-900 rounded-xl p-5 space-y-4 border border-gray-800">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Events & Goals</h2>
          <button
            onClick={addEvent}
            className="text-sm text-orange-400 hover:text-orange-300 transition-colors"
          >
            + Add event
          </button>
        </div>

        {profile.events.length === 0 && (
          <p className="text-sm text-gray-600">No events added yet.</p>
        )}

        {profile.events.map((event, i) => (
          <div key={i} className="border border-gray-800 rounded-lg p-4 space-y-3 relative">
            <button
              onClick={() => removeEvent(i)}
              className="absolute top-3 right-3 text-gray-600 hover:text-red-400 transition-colors text-xs"
            >
              Remove
            </button>
            <div className="grid grid-cols-2 gap-3">
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
            <Field label="Goal">
              <input
                type="text"
                value={event.goal}
                onChange={e => updateEvent(i, 'goal', e.target.value)}
                className={inputCls}
                placeholder="e.g. Sub 8:30, finish strong, top 10"
              />
            </Field>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="px-6 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save profile'}
        </button>
      </div>

      {/* Training Plans — managed here, shown on Training tab */}
      <TrainingPlansSettings />

      <div className="pb-8" />
    </div>
  );
}
