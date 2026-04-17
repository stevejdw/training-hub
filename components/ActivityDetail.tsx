'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { sportLabel, sportColor } from '@/lib/sport-types';
import ZoneDistribution from './ZoneDistribution';

const INTERVALS: { label: string; seconds: number }[] = [
  { label: '1 sec',   seconds: 1 },
  { label: '3 sec',   seconds: 3 },
  { label: '5 sec',   seconds: 5 },
  { label: '10 sec',  seconds: 10 },
  { label: '30 sec',  seconds: 30 },
  { label: '1 min',   seconds: 60 },
  { label: '2 min',   seconds: 120 },
  { label: '3 min',   seconds: 180 },
  { label: '5 min',   seconds: 300 },
  { label: '8 min',   seconds: 480 },
  { label: '10 min',  seconds: 600 },
  { label: '15 min',  seconds: 900 },
  { label: '20 min',  seconds: 1200 },
  { label: '30 min',  seconds: 1800 },
  { label: '45 min',  seconds: 2700 },
  { label: '60 min',  seconds: 3600 },
  { label: '90 min',  seconds: 5400 },
  { label: '2 hr',    seconds: 7200 },
  { label: '3 hr',    seconds: 10800 },
  { label: '4 hr',    seconds: 14400 },
  { label: '5 hr',    seconds: 18000 },
  { label: '6 hr',    seconds: 21600 },
  { label: '7 hr',    seconds: 25200 },
  { label: '8 hr',    seconds: 28800 },
  { label: '9 hr',    seconds: 32400 },
  { label: '10 hr',   seconds: 36000 },
  { label: '11 hr',   seconds: 39600 },
  { label: '12 hr',   seconds: 43200 },
  { label: '15 hr',   seconds: 54000 },
];

const ActivityMap = dynamic(() => import('./ActivityMap'), { ssr: false });

interface Activity {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  total_elevation_gain: number;
  average_watts: number | null;
  weighted_average_watts: number | null;
  max_watts: number | null;
  kilojoules: number | null;
  average_heartrate: number | null;
  max_heartrate: number | null;
  suffer_score: number | null;
  trainer: boolean;
  tss: number | null;
  intensity_factor: number | null;
  normalized_power: number | null;
  summary_polyline: string | null;
}

interface Lap {
  id: number;
  lap_index: number;
  name: string;
  moving_time: number;
  distance: number;
  average_watts: number | null;
  normalized_power: number | null;
  average_heartrate: number | null;
  max_heartrate: number | null;
}

function fmt(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m}:${s.toString().padStart(2, '0')}`;
}

function Stat({ label, value }: { label: string; value: string | number | null }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="bg-gray-800 rounded-xl p-2.5">
      <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">{label}</div>
      <div className="text-sm font-bold text-white leading-tight">{value}</div>
    </div>
  );
}

const FTP = 340;

export default function ActivityDetail({ id }: { id: string }) {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [laps, setLaps] = useState<Lap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [bpSeconds, setBpSeconds] = useState(300); // default 5 min
  const [bpResults, setBpResults] = useState<{ rank: number; watts: number; start: number }[] | undefined>(undefined);
  const [bpLoading, setBpLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/activities/${id}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => {
        setActivity(d.activity);
        setLaps(d.laps ?? []);
        setLoading(false);
      })
      .catch(() => { setError(true); setLoading(false); });
  }, [id]);

  useEffect(() => {
    if (!activity) return;
    setBpLoading(true);
    setBpResults(undefined);
    fetch(`/api/activities/${id}/best-power?seconds=${bpSeconds}`)
      .then(r => r.json())
      .then(d => { setBpResults(d.results ?? []); setBpLoading(false); })
      .catch(() => { setBpResults([]); setBpLoading(false); });
  }, [id, activity, bpSeconds]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
        {[1, 2, 3].map((i) => <div key={i} className="bg-gray-800 rounded-xl h-20 animate-pulse" />)}
      </div>
    );
  }

  if (error || !activity) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 text-center text-gray-400">
        Activity not found.{' '}
        <Link href="/activities" className="text-orange-400 hover:underline">Back to activities</Link>
      </div>
    );
  }

  const date = new Date(activity.start_date);
  const color = sportColor(activity.sport_type);
  const np = activity.normalized_power ?? activity.weighted_average_watts;
  const eFTPEstimate = activity.intensity_factor && activity.moving_time >= 1200
    ? Math.round(activity.intensity_factor * FTP) : null;

  return (
    <div className="h-full overflow-y-auto scroll-touch">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

        <Link href="/activities" className="text-sm text-gray-500 hover:text-orange-400 transition-colors">
          ← Activities
        </Link>

        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: color + '20', color }}>
              {sportLabel(activity.sport_type)}{activity.trainer ? ' · Indoor' : ''}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-white">{activity.name}</h1>
          <p className="text-gray-400 mt-1">
            {date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {' · '}
            {date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>

        {/* Stats + Map side by side */}
        <div className="flex gap-3 items-stretch">
          {/* Compact stats grid */}
          <div className="flex-1 grid grid-cols-2 gap-2 content-start">
            {activity.distance > 0 && <Stat label="Distance" value={`${(activity.distance / 1000).toFixed(2)} km`} />}
            <Stat label="Moving Time" value={fmt(activity.moving_time)} />
            {activity.total_elevation_gain > 0 && <Stat label="Elevation" value={`${Math.round(activity.total_elevation_gain)} m`} />}
            {activity.tss !== null && <Stat label="TSS" value={Math.round(activity.tss)} />}
            {activity.average_watts && <Stat label="Avg Power" value={`${Math.round(activity.average_watts)}W`} />}
            {np && <Stat label="NP" value={`${Math.round(np)}W`} />}
            {eFTPEstimate && <Stat label="eFTP Est." value={`${eFTPEstimate}W`} />}
            {activity.average_heartrate && <Stat label="Avg HR" value={`${Math.round(activity.average_heartrate)} bpm`} />}
            {activity.max_heartrate && <Stat label="Max HR" value={`${Math.round(activity.max_heartrate)} bpm`} />}
            {activity.intensity_factor && <Stat label="IF" value={activity.intensity_factor.toFixed(2)} />}
            {activity.max_watts && <Stat label="Peak Power" value={`${Math.round(activity.max_watts)}W`} />}
            {activity.kilojoules && <Stat label="Energy" value={`${Math.round(activity.kilojoules)} kJ`} />}
          </div>

          {/* Map — right column */}
          {activity.summary_polyline && (
            <div className="w-[45%] flex-shrink-0">
              <ActivityMap
                polyline={activity.summary_polyline}
                className="w-full h-full min-h-[200px] rounded-xl overflow-hidden bg-gray-800"
              />
            </div>
          )}
        </div>

        {/* Laps + Best Power side by side */}
        <div className="flex gap-3 items-start">

          {/* Laps — left, scrollable */}
          {laps.length > 0 ? (
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Laps <span className="text-gray-600 font-normal">({laps.length})</span>
              </h3>
              <div className="bg-gray-800 rounded-xl overflow-x-auto scroll-touch">
                <table className="text-xs whitespace-nowrap w-full">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="text-left px-2 py-2 text-gray-400 font-medium">#</th>
                      <th className="text-right px-2 py-2 text-gray-400 font-medium">Dist</th>
                      <th className="text-right px-2 py-2 text-gray-400 font-medium">Time</th>
                      <th className="text-right px-2 py-2 text-gray-400 font-medium">W</th>
                      <th className="text-right px-2 py-2 text-gray-400 font-medium">NP</th>
                      <th className="text-right px-2 py-2 text-gray-400 font-medium">HR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {laps.map((lap, i) => (
                      <tr key={lap.id} className={`border-b border-gray-700/50 ${i % 2 === 0 ? '' : 'bg-gray-900/40'}`}>
                        <td className="px-2 py-1.5 text-gray-400">{lap.lap_index + 1}</td>
                        <td className="px-2 py-1.5 text-right text-gray-300">
                          {lap.distance > 0 ? `${(lap.distance / 1000).toFixed(1)}` : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right text-gray-300">{fmt(lap.moving_time)}</td>
                        <td className="px-2 py-1.5 text-right text-gray-300">
                          {lap.average_watts ? Math.round(lap.average_watts) : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right text-gray-300">
                          {lap.normalized_power ? Math.round(lap.normalized_power) : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right text-gray-300">
                          {lap.average_heartrate ? Math.round(lap.average_heartrate) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="flex-1 bg-gray-800/50 border border-gray-700 border-dashed rounded-xl p-4 text-center">
              <p className="text-gray-500 text-xs">Lap data unavailable</p>
            </div>
          )}

          {/* Best Power — right column */}
          {activity.average_watts && (
            <div className="w-44 flex-shrink-0">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Best Power</h3>
              <div className="bg-gray-800 rounded-xl p-3 flex flex-col gap-3">
                <select
                  value={bpSeconds}
                  onChange={e => setBpSeconds(Number(e.target.value))}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-orange-500"
                >
                  {INTERVALS.map(iv => (
                    <option key={iv.seconds} value={iv.seconds}>{iv.label}</option>
                  ))}
                </select>
                {bpLoading ? (
                  <div className="space-y-1.5">
                    {[1,2,3,4,5].map(i => <div key={i} className="h-6 bg-gray-700 rounded animate-pulse" />)}
                  </div>
                ) : bpResults && bpResults.length > 0 ? (
                  <div className="space-y-1">
                    {bpResults.map(r => (
                      <div key={r.rank} className="flex items-center justify-between text-xs">
                        <span className="text-gray-500 w-5">#{r.rank}</span>
                        <span className="font-semibold text-white tabular-nums">{r.watts}<span className="text-gray-500 font-normal ml-0.5">W</span></span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-gray-500 text-center">No data</span>
                )}
              </div>
            </div>
          )}

        </div>{/* end laps+power row */}

        {/* Zone Distribution */}
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Zone Distribution</h3>
          <ZoneDistribution activityId={id} />
        </div>

        {/* No route notice (only shown when polyline is missing) */}
        {!activity.summary_polyline && (
          <div className="bg-gray-800/50 border border-gray-700 border-dashed rounded-xl p-5 text-center">
            <p className="text-gray-500 text-sm">Map unavailable — activity predates polyline sync</p>
          </div>
        )}
      </div>
    </div>
  );
}
