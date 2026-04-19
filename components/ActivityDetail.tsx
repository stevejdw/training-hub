'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { sportLabel, sportColor } from '@/lib/sport-types';
import ZoneDistribution from './ZoneDistribution';

const INTERVALS: { label: string; seconds: number }[] = [
  { label: '1 sec',  seconds: 1 },   { label: '3 sec',  seconds: 3 },
  { label: '5 sec',  seconds: 5 },   { label: '10 sec', seconds: 10 },
  { label: '30 sec', seconds: 30 },  { label: '1 min',  seconds: 60 },
  { label: '2 min',  seconds: 120 }, { label: '3 min',  seconds: 180 },
  { label: '5 min',  seconds: 300 }, { label: '8 min',  seconds: 480 },
  { label: '10 min', seconds: 600 }, { label: '15 min', seconds: 900 },
  { label: '20 min', seconds: 1200 },{ label: '30 min', seconds: 1800 },
  { label: '45 min', seconds: 2700 },{ label: '60 min', seconds: 3600 },
  { label: '90 min', seconds: 5400 },{ label: '2 hr',   seconds: 7200 },
  { label: '3 hr',   seconds: 10800 },{ label: '4 hr',  seconds: 14400 },
  { label: '5 hr',   seconds: 18000 },{ label: '6 hr',  seconds: 21600 },
  { label: '7 hr',   seconds: 25200 },{ label: '8 hr',  seconds: 28800 },
  { label: '9 hr',   seconds: 32400 },{ label: '10 hr', seconds: 36000 },
  { label: '11 hr',  seconds: 39600 },{ label: '12 hr', seconds: 43200 },
  { label: '15 hr',  seconds: 54000 },
];

const ActivityMap = dynamic(() => import('./ActivityMap'), { ssr: false });

type Tab = 'stats' | 'laps' | 'power' | 'zones' | 'segments';

interface SegmentEffort {
  id: number;
  segment_id: number;
  name: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  average_watts: number | null;
  average_heartrate: number | null;
  pr_rank: number | null;
  kom_rank: number | null;
  avg_grade: number | null;
  city: string | null;
}

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
  average_speed: number | null;
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

function StatRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="flex justify-between items-baseline py-2.5 border-b border-gray-800 last:border-0">
      <span className="text-sm text-gray-400">{label}</span>
      <span className="text-sm font-semibold text-white">{value}</span>
    </div>
  );
}

export default function ActivityDetail({ id }: { id: string }) {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [laps,     setLaps]     = useState<Lap[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(false);
  const [tab,      setTab]      = useState<Tab>('stats');
  const [bpSeconds,  setBpSeconds]  = useState(300);
  const [bpResults,  setBpResults]  = useState<{ rank: number; watts: number; max_watts: number; avg_hr: number | null; max_hr: number | null }[] | undefined>(undefined);
  const [bpLoading,  setBpLoading]  = useState(false);
  const [segments,   setSegments]   = useState<SegmentEffort[]>([]);
  const [segLoading, setSegLoading] = useState(false);
  const [segFetched, setSegFetched] = useState(false);
  const [segSyncing, setSegSyncing] = useState(false);
  type LapSortKey = 'index' | 'distance' | 'moving_time' | 'average_watts' | 'normalized_power' | 'average_heartrate' | 'max_heartrate';
  const [lapSort, setLapSort] = useState<{ key: LapSortKey; dir: 'asc' | 'desc' }>({ key: 'index', dir: 'asc' });

  useEffect(() => {
    fetch(`/api/activities/${id}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { setActivity(d.activity); setLaps(d.laps ?? []); setLoading(false); })
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

  // Lazy-load segments only when Segments tab is opened
  useEffect(() => {
    if (tab !== 'segments' || segFetched) return;
    setSegLoading(true);
    fetch(`/api/activities/${id}/segments`)
      .then(r => r.json())
      .then(d => { setSegments(d.efforts ?? []); setSegFetched(true); setSegLoading(false); })
      .catch(() => { setSegFetched(true); setSegLoading(false); });
  }, [tab, id, segFetched]);

  function syncSegments() {
    setSegSyncing(true);
    setSegFetched(false);
    fetch(`/api/activities/${id}/segments`, { method: 'POST' })
      .then(r => r.json())
      .then(d => { setSegments(d.efforts ?? []); setSegFetched(true); setSegSyncing(false); })
      .catch(() => { setSegFetched(true); setSegSyncing(false); });
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-4">
        {[1,2,3].map(i => <div key={i} className="bg-gray-800 rounded-xl h-20 animate-pulse" />)}
      </div>
    );
  }

  if (error || !activity) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 text-center text-gray-400">
        Activity not found.{' '}
        <Link href="/activities" className="text-orange-400 hover:underline">Back to activities</Link>
      </div>
    );
  }

  const date   = new Date(activity.start_date);
  const color  = sportColor(activity.sport_type);
  const np     = activity.normalized_power ?? activity.weighted_average_watts;
  const speedKph = activity.average_speed ? (activity.average_speed * 3.6).toFixed(1) : null;

  const TABS: { key: Tab; label: string }[] = [
    { key: 'stats',    label: 'Stats' },
    { key: 'laps',     label: `Laps${laps.length ? ` (${laps.length})` : ''}` },
    { key: 'power',    label: 'Power' },
    { key: 'zones',    label: 'Time in Zones' },
    { key: 'segments', label: `Segments${segments.length ? ` (${segments.length})` : ''}` },
  ];

  return (
    <div className="h-full overflow-y-auto scroll-touch">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">

        <Link href="/activities" className="text-sm text-gray-500 hover:text-orange-400 transition-colors">
          ← Activities
        </Link>

        {/* Header + Map */}
        <div className="flex gap-4 items-start">
          <div className="flex-1 min-w-0">
            {/* Sport badge + date */}
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: color + '20', color }}>
                {sportLabel(activity.sport_type)}{activity.trainer ? ' · Indoor' : ''}
              </span>
              <span className="text-xs text-gray-500">
                {date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                {' · '}
                {date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            {/* Activity name */}
            <h1 className="text-xl font-bold text-white mb-4 leading-tight">{activity.name}</h1>

            {/* Key stats strip */}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              {activity.distance > 0 && (
                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Distance</div>
                  <div className="text-base font-bold text-white">{(activity.distance / 1000).toFixed(2)}<span className="text-xs text-gray-400 ml-1">km</span></div>
                </div>
              )}
              {speedKph && (
                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Avg Speed</div>
                  <div className="text-base font-bold text-white">{speedKph}<span className="text-xs text-gray-400 ml-1">km/h</span></div>
                </div>
              )}
              {activity.average_watts && (
                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Avg Power</div>
                  <div className="text-base font-bold text-white">{Math.round(activity.average_watts)}<span className="text-xs text-gray-400 ml-1">W</span></div>
                </div>
              )}
              <div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Time</div>
                <div className="text-base font-bold text-white">{fmt(activity.moving_time)}</div>
              </div>
              {activity.total_elevation_gain > 0 && (
                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Ascent</div>
                  <div className="text-base font-bold text-white">{Math.round(activity.total_elevation_gain)}<span className="text-xs text-gray-400 ml-1">m</span></div>
                </div>
              )}
            </div>
          </div>

          {/* Map */}
          {activity.summary_polyline ? (
            <div className="w-[42%] flex-shrink-0 hidden sm:block">
              <ActivityMap
                polyline={activity.summary_polyline}
                className="w-full h-48 rounded-xl overflow-hidden bg-gray-800"
              />
            </div>
          ) : null}
        </div>

        {/* Mobile map (full width below header) */}
        {activity.summary_polyline && (
          <div className="sm:hidden">
            <ActivityMap
              polyline={activity.summary_polyline}
              className="w-full h-48 rounded-xl overflow-hidden bg-gray-800"
            />
          </div>
        )}

        {/* Tabs */}
        <div className="border-b border-gray-800">
          <div className="flex items-center gap-0">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  tab === t.key
                    ? 'border-orange-500 text-white'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                {t.label}
              </button>
            ))}
            <button
              onClick={syncSegments}
              disabled={segSyncing}
              title="Re-sync starred segments for this activity"
              className="ml-auto mr-1 flex items-center gap-1.5 text-xs text-gray-500 hover:text-orange-400 disabled:opacity-40 transition-colors px-2 py-1.5"
            >
              <svg
                className={`w-3.5 h-3.5 ${segSyncing ? 'animate-spin' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {segSyncing ? 'Syncing…' : 'Sync Segments'}
            </button>
          </div>
        </div>

        {/* Tab: Stats */}
        {tab === 'stats' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Performance</p>
              <StatRow label="Moving Time"    value={fmt(activity.moving_time)} />
              <StatRow label="Elapsed Time"   value={fmt(activity.elapsed_time)} />
              <StatRow label="Distance"       value={activity.distance > 0 ? `${(activity.distance / 1000).toFixed(2)} km` : null} />
              <StatRow label="Avg Speed"      value={speedKph ? `${speedKph} km/h` : null} />
              <StatRow label="Elevation"      value={activity.total_elevation_gain > 0 ? `${Math.round(activity.total_elevation_gain)} m` : null} />
              <StatRow label="TSS"            value={activity.tss !== null ? Math.round(activity.tss) : null} />
              <StatRow label="Suffer Score"   value={activity.suffer_score} />
            </div>
            <div className="mt-6 sm:mt-0">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Power & HR</p>
              <StatRow label="Avg Power"      value={activity.average_watts ? `${Math.round(activity.average_watts)} W` : null} />
              <StatRow label="Norm. Power"    value={np ? `${Math.round(np)} W` : null} />
              <StatRow label="Max Power"      value={activity.max_watts ? `${Math.round(activity.max_watts)} W` : null} />
              <StatRow label="Intensity Factor" value={activity.intensity_factor ? activity.intensity_factor.toFixed(2) : null} />
              <StatRow label="Energy"         value={activity.kilojoules ? `${Math.round(activity.kilojoules)} kJ` : null} />
              <StatRow label="Avg Heart Rate" value={activity.average_heartrate ? `${Math.round(activity.average_heartrate)} bpm` : null} />
              <StatRow label="Max Heart Rate" value={activity.max_heartrate ? `${Math.round(activity.max_heartrate)} bpm` : null} />
            </div>
          </div>
        )}

        {/* Tab: Laps */}
        {tab === 'laps' && (() => {
          if (laps.length === 0) return (
            <div className="bg-gray-800/50 border border-gray-700 border-dashed rounded-xl p-8 text-center">
              <p className="text-gray-500 text-sm">No lap data for this activity</p>
            </div>
          );

          const sortedLaps = [...laps].sort((a, b) => {
            let av: number, bv: number;
            if (lapSort.key === 'index') {
              av = a.lap_index; bv = b.lap_index;
            } else {
              av = (a[lapSort.key] as number | null) ?? -Infinity;
              bv = (b[lapSort.key] as number | null) ?? -Infinity;
            }
            return lapSort.dir === 'asc' ? av - bv : bv - av;
          });

          function SortTh({ col, label, align = 'right' }: { col: LapSortKey; label: string; align?: 'left' | 'right' }) {
            const active = lapSort.key === col;
            const arrow  = active ? (lapSort.dir === 'asc' ? ' ↑' : ' ↓') : '';
            return (
              <th
                className={`px-4 py-3 font-medium cursor-pointer select-none whitespace-nowrap
                  ${align === 'left' ? 'text-left' : 'text-right'}
                  ${active ? 'text-orange-400' : 'text-gray-500 hover:text-gray-300'}`}
                onClick={() => setLapSort(s =>
                  s.key === col
                    ? { key: col, dir: s.dir === 'asc' ? 'desc' : 'asc' }
                    : { key: col, dir: col === 'index' ? 'asc' : 'desc' }
                )}
              >
                {label}{arrow}
              </th>
            );
          }

          return (
            <div className="bg-gray-900 rounded-xl overflow-x-auto scroll-touch border border-gray-800">
              <table className="text-sm whitespace-nowrap w-full">
                <thead>
                  <tr className="border-b border-gray-800">
                    <SortTh col="index"             label="#"        align="left" />
                    <SortTh col="distance"          label="Distance" />
                    <SortTh col="moving_time"       label="Time" />
                    <SortTh col="average_watts"     label="Avg W" />
                    <SortTh col="normalized_power"  label="NP" />
                    <SortTh col="average_heartrate" label="Avg HR" />
                    <SortTh col="max_heartrate"     label="Max HR" />
                  </tr>
                </thead>
                <tbody>
                  {sortedLaps.map((lap, i) => (
                    <tr key={lap.id} className={`border-b border-gray-800/60 ${i % 2 === 0 ? '' : 'bg-gray-800/30'}`}>
                      <td className="px-4 py-2.5 text-gray-400">{lap.lap_index}</td>
                      <td className="px-4 py-2.5 text-right text-gray-300">
                        {lap.distance > 0 ? `${(lap.distance / 1000).toFixed(2)} km` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-300">{fmt(lap.moving_time)}</td>
                      <td className="px-4 py-2.5 text-right text-white font-medium">
                        {lap.average_watts ? Math.round(lap.average_watts) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-300">
                        {lap.normalized_power ? Math.round(lap.normalized_power) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-300">
                        {lap.average_heartrate ? Math.round(lap.average_heartrate) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-300">
                        {lap.max_heartrate ? Math.round(lap.max_heartrate) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}

        {/* Tab: Power */}
        {tab === 'power' && (
          activity.average_watts ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <select
                  value={bpSeconds}
                  onChange={e => setBpSeconds(Number(e.target.value))}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                >
                  {INTERVALS.map(iv => (
                    <option key={iv.seconds} value={iv.seconds}>{iv.label}</option>
                  ))}
                </select>
                <span className="text-xs text-gray-500">Top 5 non-overlapping best efforts</span>
              </div>

              {bpLoading ? (
                <div className="space-y-2">
                  {[1,2,3,4,5].map(i => <div key={i} className="h-10 bg-gray-800 rounded-xl animate-pulse" />)}
                </div>
              ) : bpResults && bpResults.length > 0 ? (
                <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-x-auto scroll-touch">
                  <table className="text-sm w-full whitespace-nowrap">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left px-4 py-3 text-gray-500 font-medium">#</th>
                        <th className="text-right px-4 py-3 text-gray-500 font-medium">Avg Power</th>
                        <th className="text-right px-4 py-3 text-gray-500 font-medium">Max Power</th>
                        <th className="text-right px-4 py-3 text-gray-500 font-medium">Avg HR</th>
                        <th className="text-right px-4 py-3 text-gray-500 font-medium">Max HR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bpResults.map((r, i) => (
                        <tr key={r.rank} className={`border-b border-gray-800/60 last:border-0 ${i === 0 ? 'bg-orange-500/5' : i % 2 !== 0 ? 'bg-gray-800/30' : ''}`}>
                          <td className={`px-4 py-3 font-medium ${i === 0 ? 'text-orange-400' : 'text-gray-500'}`}>#{r.rank}</td>
                          <td className={`px-4 py-3 text-right font-bold tabular-nums ${i === 0 ? 'text-white' : 'text-gray-200'}`}>
                            {r.watts} <span className="text-xs font-normal text-gray-500">W</span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-300">
                            {r.max_watts} <span className="text-xs text-gray-500">W</span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-300">
                            {r.avg_hr ? <>{r.avg_hr} <span className="text-xs text-gray-500">bpm</span></> : '—'}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-300">
                            {r.max_hr ? <>{r.max_hr} <span className="text-xs text-gray-500">bpm</span></> : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-gray-500 py-4">No power data</p>
              )}
            </div>
          ) : (
            <div className="bg-gray-800/50 border border-gray-700 border-dashed rounded-xl p-8 text-center">
              <p className="text-gray-500 text-sm">No power data for this activity</p>
            </div>
          )
        )}

        {/* Tab: Time in Zones */}
        {tab === 'zones' && (
          <ZoneDistribution activityId={id} />
        )}

        {/* Tab: Segments */}
        {tab === 'segments' && (
          <div>
            {segLoading ? (
              <div className="space-y-2">
                {[1,2,3].map(i => <div key={i} className="h-16 bg-gray-800 rounded-xl animate-pulse" />)}
              </div>
            ) : segments.length === 0 ? (
              <div className="bg-gray-800/40 rounded-xl p-6 text-center space-y-2">
                <p className="text-gray-400 text-sm">No starred segments matched this activity.</p>
                <p className="text-gray-500 text-xs">
                  Star segments on Strava, then{' '}
                  <button
                    onClick={async () => {
                      await fetch('/api/segments/starred', { method: 'POST' });
                      setSegFetched(false);
                    }}
                    className="text-orange-400 hover:underline"
                  >
                    re-sync
                  </button>
                  {' '}to update your list.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {segments.map(seg => {
                  const mins  = Math.floor(seg.elapsed_time / 60);
                  const secs  = seg.elapsed_time % 60;
                  const timeStr = mins > 0
                    ? `${mins}:${secs.toString().padStart(2,'0')}`
                    : `0:${secs.toString().padStart(2,'0')}`;
                  const isPR  = seg.pr_rank === 1;
                  const isTop3 = seg.kom_rank !== null && seg.kom_rank <= 3;

                  return (
                    <Link
                      key={seg.id}
                      href={`/segments/${seg.segment_id}`}
                      className={`block rounded-xl p-4 border transition-colors hover:border-gray-600/60 ${
                        isPR
                          ? 'bg-yellow-500/10 border-yellow-500/40'
                          : 'bg-gray-800/60 border-gray-700/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-sm font-semibold text-white truncate">{seg.name}</span>
                            {isPR && (
                              <span className="text-[10px] bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-1.5 py-0.5 rounded font-bold flex-shrink-0">🏆 PR</span>
                            )}
                            {isTop3 && !isPR && (
                              <span className="text-[10px] bg-orange-500/20 text-orange-400 border border-orange-500/30 px-1.5 py-0.5 rounded font-bold flex-shrink-0">Top {seg.kom_rank}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 flex-wrap text-xs text-gray-400">
                            {seg.distance > 0 && (
                              <span>{(seg.distance / 1000).toFixed(1)} km</span>
                            )}
                            {seg.avg_grade !== null && (
                              <span>{seg.avg_grade.toFixed(1)}% avg</span>
                            )}
                            {seg.city && <span>{seg.city}</span>}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 space-y-1">
                          <p className={`text-lg font-bold tabular-nums ${isPR ? 'text-yellow-300' : 'text-white'}`}>{timeStr}</p>
                          <div className="flex items-center gap-2 justify-end text-xs text-gray-400">
                            {seg.average_watts && (
                              <span>{Math.round(seg.average_watts)}W</span>
                            )}
                            {seg.average_heartrate && (
                              <span className="text-red-400">♥ {Math.round(seg.average_heartrate)}</span>
                            )}
                          </div>
                          <span className="text-[10px] text-orange-400 mt-1 block">History →</span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
