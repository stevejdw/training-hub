'use client';

import TrainingPlansSettings from '@/components/training/TrainingPlansSettings';
import type { AthleteProfile } from '@/lib/profile';
import type { SettingsCtx } from './types';
import { Field, Group, Row, inputCls } from './ui';

const TIMEZONES = [
  'Pacific/Auckland', 'Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane',
  'Australia/Adelaide', 'Australia/Perth', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore',
  'Asia/Kolkata', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'America/New_York',
  'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Vancouver',
  'America/Toronto', 'UTC',
];

/** Offset rendered from the zone itself rather than hand-written in twenty
 *  option labels — those went stale every time a DST rule changed. */
function tzLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-AU', { timeZone: tz, timeZoneName: 'shortOffset' })
      .formatToParts(new Date());
    const offset = parts.find(p => p.type === 'timeZoneName')?.value;
    return offset ? `${tz} (${offset})` : tz;
  } catch {
    return tz;
  }
}

/** Numbers worth seeing on the hub row without opening the screen. */
export function athleteSummary(profile: AthleteProfile): string {
  const bits: string[] = [];
  if (profile.max_hr)    bits.push(`${profile.max_hr} bpm`);
  if (profile.weight_kg) bits.push(`${profile.weight_kg} kg`);
  return bits.length ? bits.join(' · ') : 'Not set';
}

export default function AthleteSection({ ctx }: { ctx: SettingsCtx }) {
  const { profile, update, updateAndSave, save } = ctx;

  const num = (key: keyof AthleteProfile, props: { placeholder: string; step?: number; min: number; max: number }) => (
    <input
      type="number"
      inputMode="decimal"
      value={(profile[key] as number | null) ?? ''}
      onChange={e => update(key, (e.target.value ? Number(e.target.value) : null) as AthleteProfile[typeof key])}
      onBlur={() => { void save(); }}
      className={inputCls}
      {...props}
    />
  );

  return (
    <>
      <Group title="Physical" footer="Used for HR-based TSS on non-power rides, climb time estimates and pacing strategy.">
        <div className="grid grid-cols-2 divide-x divide-line">
          <Field label="Max HR">{num('max_hr', { placeholder: '193', step: 1, min: 100, max: 250 })}</Field>
          <Field
            label="Threshold HR"
            hint={profile.lthr ? undefined : profile.max_hr ? `Defaults to ${Math.round(profile.max_hr * 0.9)}` : 'Set max HR first'}
          >
            {num('lthr', { placeholder: profile.max_hr ? String(Math.round(profile.max_hr * 0.9)) : '173', step: 1, min: 80, max: 220 })}
          </Field>
        </div>
        <div className="grid grid-cols-2 divide-x divide-line">
          <Field label="Rider weight (kg)">{num('weight_kg', { placeholder: '75', step: 0.5, min: 40, max: 150 })}</Field>
          <Field label="Bike weight (kg)">{num('bike_weight_kg', { placeholder: '8', step: 0.5, min: 3, max: 20 })}</Field>
        </div>
      </Group>

      <Group title="Timezone" footer="Every date in the app — activity days, calendar views, plan generation — is resolved in this zone.">
        <Row>
          <select
            value={profile.timezone || 'Australia/Sydney'}
            onChange={e => { void updateAndSave('timezone', e.target.value); }}
            className={inputCls}
          >
            {TIMEZONES.map(tz => (
              <option key={tz} value={tz}>{tzLabel(tz)}</option>
            ))}
          </select>
        </Row>
      </Group>

      <TrainingPlansSettings />
    </>
  );
}
