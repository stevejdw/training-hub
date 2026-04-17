'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
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
        const rangeLow  = z.min === 0 ? (unit === 'W' ? '0' : '<' + (z.max! + 1)) : String(z.min);
        const rangeHigh = z.max === null ? `${z.min}+` : `${z.min} – ${z.max}`;
        const rangeStr  = z.min === 0 && unit === 'bpm'
          ? `< ${z.max! + 1}`
          : z.max === null
            ? `> ${z.min - 1}`
            : `${z.min} – ${z.max}`;
        const barPct = maxSecs > 0 ? (z.seconds / maxSecs) * 100 : 0;

        return (
          <div key={z.z} className="grid items-center gap-2 text-xs" style={{ gridTemplateColumns: '28px 80px 90px 52px 36px 1fr' }}>
            {/* Zone # */}
            <span className="text-gray-500 font-medium text-center">Z{z.z}</span>
            {/* Name */}
            <span className="text-gray-300 truncate">{z.name}</span>
            {/* Range */}
            <span className="text-gray-500 tabular-nums">{rangeStr} {unit}</span>
            {/* Time */}
            <span className="text-white font-semibold tabular-nums text-right">{fmtTime(z.seconds)}</span>
            {/* % */}
            <span className="text-gray-400 tabular-nums text-right">{z.pct}%</span>
            {/* Bar */}
            <div className="h-4 rounded-sm overflow-hidden bg-gray-800/60">
              <div
                className="h-full rounded-sm transition-all duration-500"
                style={{ width: `${barPct}%`, background: z.color }}
              />
            </div>
          </div>
        );
        void rangeLow;
      })}
    </div>
  );
}

export default function ZoneDistribution({ activityId }: { activityId: string }) {
  const [data,    setData]    = useState<ZonesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/activities/${activityId}/zones`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [activityId]);

  if (loading) {
    return <div className="h-40 bg-gray-800 rounded-xl animate-pulse" />;
  }

  if (!data || (!data.power && !data.hr)) {
    return (
      <div className="bg-gray-800/50 border border-gray-700 border-dashed rounded-xl p-4 text-center">
        <p className="text-gray-500 text-xs">
          No stream data — run the{' '}
          <Link href="/profile" className="text-orange-400 hover:underline">backfill workflow</Link>
        </p>
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
            <span className="text-xs text-gray-600">Max HR {data.max_hr}</span>
          </div>
          <ZoneTable zones={data.hr} maxSecs={hrMax} unit="bpm" />
        </div>
      ) : data.has_hr_stream && !data.max_hr ? (
        <p className="text-xs text-gray-500">
          HR stream available — set your{' '}
          <Link href="/profile" className="text-orange-400 hover:underline">Max HR in settings</Link>
          {' '}to see HR zones
        </p>
      ) : !data.has_hr_stream ? (
        <p className="text-xs text-gray-600">No HR stream data for this activity</p>
      ) : null}
    </div>
  );
}
