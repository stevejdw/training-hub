'use client';

import { useEffect, useState } from 'react';
import { ZoneResult } from '@/lib/zones';

interface ZonesResponse {
  power: ZoneResult[] | null;
  hr:    ZoneResult[] | null;
  has_hr_stream: boolean;
  ftp:   number;
  max_hr: number | null;
}

function fmtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function ZoneTable({ zones, maxSecs, unit }: { zones: ZoneResult[]; maxSecs: number; unit: 'W' | 'bpm' }) {
  return (
    <div className="space-y-1">
      {[...zones].reverse().map(z => {
        const rangeStr = z.min === 0 && unit === 'bpm'
          ? `< ${z.max! + 1}`
          : z.max === null
            ? `> ${z.min - 1}`
            : `${z.min} – ${z.max}`;
        const barPct = maxSecs > 0 ? (z.seconds / maxSecs) * 100 : 0;

        return (
          <div key={z.z} className="grid items-center gap-2 text-xs" style={{ gridTemplateColumns: '28px 80px 90px 52px 36px 1fr' }}>
            <span className="text-gray-500 font-medium text-center">Z{z.z}</span>
            <span className="text-gray-300 truncate">{z.name}</span>
            <span className="text-gray-500 tabular-nums">{rangeStr} {unit}</span>
            <span className="text-white font-semibold tabular-nums text-right">{fmtTime(z.seconds)}</span>
            <span className="text-gray-400 tabular-nums text-right">{z.pct}%</span>
            <div className="h-4 rounded-sm overflow-hidden bg-gray-800/60">
              <div
                className="h-full rounded-sm transition-all duration-500"
                style={{ width: `${barPct}%`, background: z.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SetMaxHrPrompt({ onSaved }: { onSaved: (maxHr: number) => void }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    const n = parseInt(value, 10);
    if (!n || n < 100 || n > 230) return;
    setSaving(true);
    // Fetch current profile, merge max_hr, save back
    const profile = await fetch('/api/profile').then(r => r.json());
    await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...profile, max_hr: n }),
    });
    setSaving(false);
    onSaved(n);
  }

  return (
    <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-4">
      <p className="text-sm font-medium text-orange-300 mb-1">HR stream available</p>
      <p className="text-xs text-gray-400 mb-3">Set your Max HR to calculate heart rate zones.</p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="e.g. 185"
          min={100}
          max={230}
          className="w-28 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500"
          onKeyDown={e => e.key === 'Enter' && save()}
        />
        <span className="text-xs text-gray-500">bpm</span>
        <button
          onClick={save}
          disabled={saving || !value}
          className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-40 text-white text-xs font-medium transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export default function ZoneDistribution({ activityId }: { activityId: string }) {
  const [data,      setData]      = useState<ZonesResponse | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [fetching,  setFetching]  = useState(false);
  const [fetchMsg,  setFetchMsg]  = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetch(`/api/activities/${activityId}/zones`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }

  async function fetchStreams() {
    setFetching(true);
    setFetchMsg(null);
    const res = await fetch(`/api/activities/${activityId}/fetch-streams`, { method: 'POST' });
    const json = await res.json() as { ok: boolean; has_hr?: boolean; message?: string };
    if (json.ok && json.has_hr) {
      load(); // reload zone data
    } else {
      setFetchMsg(json.message ?? 'No HR data available from Strava for this activity');
    }
    setFetching(false);
  }

  useEffect(() => { load(); }, [activityId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <div className="h-40 bg-gray-800 rounded-xl animate-pulse" />;
  }

  // No stream data at all (activity predates backfill)
  if (!data || (!data.power && !data.hr && !data.has_hr_stream)) {
    return (
      <div className="bg-gray-800/50 border border-gray-700 border-dashed rounded-xl p-4 flex items-center justify-between gap-4">
        <p className="text-gray-500 text-xs">No stream data stored for this activity.</p>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <button
            onClick={fetchStreams}
            disabled={fetching}
            className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-40 text-white text-xs font-medium transition-colors whitespace-nowrap"
          >
            {fetching ? 'Fetching…' : 'Fetch from Strava'}
          </button>
          {fetchMsg && <p className="text-xs text-gray-500 text-right">{fetchMsg}</p>}
        </div>
      </div>
    );
  }

  const powerMax = data.power ? Math.max(...data.power.map(z => z.seconds)) : 0;
  const hrMax    = data.hr    ? Math.max(...data.hr.map(z => z.seconds))    : 0;

  return (
    <div className="space-y-5">
      {/* Power zones */}
      {data.power && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Power Zones</h4>
            <span className="text-xs text-gray-600">FTP {data.ftp}W</span>
          </div>
          <ZoneTable zones={data.power} maxSecs={powerMax} unit="W" />
        </div>
      )}

      {/* HR zones */}
      {data.hr ? (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Heart Rate Zones</h4>
            <span className="text-xs text-gray-600">Max HR {data.max_hr} bpm</span>
          </div>
          <ZoneTable zones={data.hr} maxSecs={hrMax} unit="bpm" />
        </div>
      ) : data.has_hr_stream && !data.max_hr ? (
        <SetMaxHrPrompt onSaved={() => load()} />
      ) : data.has_hr_stream ? (
        <p className="text-xs text-gray-500">Unable to calculate HR zones</p>
      ) : (
        <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4 flex items-center justify-between gap-4">
          <p className="text-xs text-gray-400">HR stream not stored for this activity.</p>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <button
              onClick={fetchStreams}
              disabled={fetching}
              className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-40 text-white text-xs font-medium transition-colors whitespace-nowrap"
            >
              {fetching ? 'Fetching…' : 'Fetch from Strava'}
            </button>
            {fetchMsg && <p className="text-xs text-gray-500 text-right">{fetchMsg}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
