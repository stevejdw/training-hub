'use client';

import { useEffect, useState } from 'react';
import { PowerTarget } from '@/lib/profile';
import { iconFor } from '@/components/nav-items';
import { PageShell, inputCls, useProfileEdit } from '@/lib/use-profile-edit';
import SaveStatus from '@/components/ui/SaveStatus';

const TIMEZONES = [
  { label: 'Sydney / Melbourne (AEST/AEDT)',  value: 'Australia/Sydney'    },
  { label: 'Brisbane (AEST)',                  value: 'Australia/Brisbane'  },
  { label: 'Adelaide (ACST/ACDT)',             value: 'Australia/Adelaide'  },
  { label: 'Perth (AWST)',                     value: 'Australia/Perth'     },
  { label: 'Auckland (NZST/NZDT)',             value: 'Pacific/Auckland'    },
  { label: 'London (GMT/BST)',                 value: 'Europe/London'       },
  { label: 'Paris / Berlin (CET/CEST)',        value: 'Europe/Paris'        },
  { label: 'New York (EST/EDT)',               value: 'America/New_York'    },
  { label: 'Los Angeles (PST/PDT)',            value: 'America/Los_Angeles' },
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-ink-3 uppercase tracking-wider mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-ink-5 mt-1">{hint}</p>}
    </div>
  );
}

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-xl p-5 space-y-4 border border-line">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-2 uppercase tracking-wider">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

export default function ProfileContent() {
  const { profile, setProfile, update, save, saving, saved, error } = useProfileEdit();
  const [eftpData, setEftpData] = useState<EftpData | null>(null);

  useEffect(() => {
    fetch('/api/profile/eftp-options').then(r => r.json()).then(setEftpData).catch(() => {});
  }, []);

  if (!profile) {
    return <PageShell title="Profile" icon={iconFor("profile")}><div className="text-ink-4 text-sm">Loading…</div></PageShell>;
  }

  const displayFtp = profile.use_eftp && profile.eftp ? profile.eftp : profile.ftp;

  function addPowerTarget() {
    const t: PowerTarget = { id: String(Date.now()), label: '5 min', seconds: 300, repeats: undefined, target_watts: 300, notes: '' };
    setProfile(prev => prev ? { ...prev, power_targets: [...(prev.power_targets ?? []), t] } : prev);
  }
  function updatePT(i: number, field: keyof PowerTarget, value: unknown) {
    setProfile(prev => {
      if (!prev) return prev;
      return { ...prev, power_targets: (prev.power_targets ?? []).map((t, idx) => idx === i ? { ...t, [field]: value } : t) };
    });
  }
  function removePT(i: number) {
    setProfile(prev => prev ? { ...prev, power_targets: (prev.power_targets ?? []).filter((_, idx) => idx !== i) } : prev);
  }

  return (
    <PageShell title="Profile" icon={iconFor("profile")}>
      {/* Basic info */}
      <Card title="Basic Info">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name">
            <input type="text" value={profile.name} onChange={e => update('name', e.target.value)} className={inputCls} placeholder="Your name" />
          </Field>
          <Field label="Weight (kg)" hint="Used for w/kg calculations">
            <input type="number" value={profile.weight_kg ?? ''} onChange={e => update('weight_kg', e.target.value ? Number(e.target.value) : null)} className={inputCls} placeholder="e.g. 75" min={30} max={200} step={0.1} />
          </Field>
        </div>
        <Field label="Timezone" hint="Used for weekly summaries and date calculations">
          <select value={profile.timezone ?? 'Australia/Sydney'} onChange={e => update('timezone', e.target.value)} className={inputCls}>
            {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
          </select>
        </Field>
      </Card>

      {/* FTP */}
      <Card title="Power — FTP" action={<span className="text-accent-hi font-bold text-lg">{displayFtp}W active</span>}>
        <Field label="Manual FTP">
          <input type="number" value={profile.ftp} onChange={e => update('ftp', Number(e.target.value))} className={inputCls} min={100} max={600} />
        </Field>
        <Field label="Use eFTP instead of manual FTP">
          <div className="flex items-center gap-3 mt-1">
            <button onClick={() => update('use_eftp', !profile.use_eftp)} className={`relative w-10 h-5 rounded-full transition-colors ${profile.use_eftp ? 'bg-accent' : 'bg-hover'}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${profile.use_eftp ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
            <span className="text-sm text-ink-3">{profile.use_eftp ? 'Using eFTP' : 'Using manual FTP'}</span>
          </div>
        </Field>
        {profile.use_eftp && eftpData && eftpData.best_eftp && (
          <div className="rounded-xl border border-accent/30 bg-accent/5 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-bold text-ink">{eftpData.best_eftp}<span className="text-sm font-normal text-ink-3 ml-1">W</span></p>
                <p className="text-xs text-ink-4">From {eftpData.best_duration} best power (last 14 days)</p>
              </div>
              <button onClick={() => update('eftp', eftpData.best_eftp)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${profile.eftp === eftpData.best_eftp ? 'bg-accent text-ink' : 'bg-accent/20 text-accent-hi hover:bg-accent/30'}`}>
                {profile.eftp === eftpData.best_eftp ? 'Applied' : 'Use this'}
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* Zones */}
      <Card title="Zone Settings">
        <div className="space-y-3">
          <h3 className="text-xs font-medium text-ink-3 uppercase tracking-wider">Heart Rate Zones</h3>
          <Field label="Max HR (bpm)" hint="Required to calculate HR zones">
            <input type="number" value={profile.max_hr ?? ''} onChange={e => update('max_hr', e.target.value ? Number(e.target.value) : null)} className={inputCls} placeholder="e.g. 185" min={100} max={230} />
          </Field>
          <Field label="HR zone calculation">
            <div className="flex items-center gap-3 mt-1">
              <button onClick={() => update('hr_zones_auto', !profile.hr_zones_auto)} className={`relative w-10 h-5 rounded-full transition-colors ${profile.hr_zones_auto ? 'bg-accent' : 'bg-hover'}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${profile.hr_zones_auto ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
              <span className="text-sm text-ink-3">{profile.hr_zones_auto ? 'Auto (% of Max HR)' : 'Manual boundaries'}</span>
            </div>
          </Field>
        </div>
        <div className="space-y-3 pt-2 border-t border-line">
          <h3 className="text-xs font-medium text-ink-3 uppercase tracking-wider">Power Zones</h3>
          <Field label="Power zone calculation">
            <div className="flex items-center gap-3 mt-1">
              <button onClick={() => update('power_zones_auto', !profile.power_zones_auto)} className={`relative w-10 h-5 rounded-full transition-colors ${profile.power_zones_auto ? 'bg-accent' : 'bg-hover'}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${profile.power_zones_auto ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
              <span className="text-sm text-ink-3">{profile.power_zones_auto ? 'Auto (% of FTP)' : 'Manual boundaries'}</span>
            </div>
          </Field>
        </div>
      </Card>

      {/* Power Efforts */}
      <Card
        title="Power Efforts"
        action={(profile.power_targets ?? []).length < 6 ? (
          <button onClick={addPowerTarget} className="text-sm text-accent-hi hover:text-accent-hi transition-colors">+ Add</button>
        ) : null}
      >
        <p className="text-xs text-ink-5 -mt-2">Drives the Performance chart. Up to 6 shown; defaults fill any gaps.</p>
        {(profile.power_targets ?? []).length === 0 && <p className="text-sm text-ink-5 py-1">Using defaults: 3, 5, 10, 20, 30, 60 min.</p>}
        <div className="space-y-2">
          {(profile.power_targets ?? []).map((t, i) => (
            <div key={t.id} className="grid grid-cols-[1fr_70px_80px_auto] gap-2 items-end">
              <div>
                {i === 0 && <div className="text-micro text-ink-5 mb-1 uppercase tracking-wider">Duration</div>}
                <select
                  value={t.seconds}
                  onChange={e => {
                    const s = Number(e.target.value);
                    const labels: Record<number,string> = {60:'1 min',120:'2 min',180:'3 min',300:'5 min',480:'8 min',600:'10 min',900:'15 min',1200:'20 min',1800:'30 min',2700:'45 min',3600:'60 min'};
                    updatePT(i, 'seconds', s);
                    updatePT(i, 'label', labels[s] ?? `${Math.round(s/60)} min`);
                  }}
                  className={inputCls}
                >
                  {[[60,'1 min'],[120,'2 min'],[180,'3 min'],[300,'5 min'],[480,'8 min'],[600,'10 min'],[900,'15 min'],[1200,'20 min'],[1800,'30 min'],[2700,'45 min'],[3600,'60 min']].map(([s, l]) => <option key={s} value={s as number}>{l}</option>)}
                </select>
              </div>
              <div>
                {i === 0 && <div className="text-micro text-ink-5 mb-1 uppercase tracking-wider">Reps</div>}
                <input type="number" value={t.repeats ?? ''} onChange={e => updatePT(i, 'repeats', e.target.value ? Number(e.target.value) : undefined)} className={inputCls} placeholder="e.g. 3" min={1} max={20} />
              </div>
              <div>
                {i === 0 && <div className="text-micro text-ink-5 mb-1 uppercase tracking-wider">Target W</div>}
                <input type="number" value={t.target_watts} onChange={e => updatePT(i, 'target_watts', Number(e.target.value))} className={inputCls} placeholder="W" min={50} max={2000} />
              </div>
              <button onClick={() => removePT(i)} className={`text-ink-5 hover:text-red-400 transition-colors text-xs px-1 py-2 ${i === 0 ? 'mt-5' : ''}`}>✕</button>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex justify-end items-center gap-3">
        <SaveStatus error={error} onRetry={() => save()} />
        <button onClick={() => save()} disabled={saving} className="px-6 py-2.5 rounded-lg bg-accent hover:bg-accent-hi disabled:opacity-50 text-ink text-sm font-medium transition-colors">
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save profile'}
        </button>
      </div>
    </PageShell>
  );
}
