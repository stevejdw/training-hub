'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

const ActivityMap = dynamic(() => import('./ActivityMap'), { ssr: false });

interface Segment {
  id: number;
  name: string;
  distance: number;
  avg_grade: number | null;
  city: string | null;
  country: string | null;
  elevation_high: number | null;
  elevation_low: number | null;
  total_elevation_gain: number | null;
  climb_category: number | null;
  polyline: string | null;
  effort_count: number | null;
  athlete_count: number | null;
  altitude_stream: number[] | null;
  distance_stream: number[] | null;
}

interface Effort {
  id: number;
  activity_id: number;
  elapsed_time: number;
  start_date: string;
  average_watts: number | null;
  average_heartrate: number | null;
  max_heartrate: number | null;
  pr_rank: number | null;
  kom_rank: number | null;
  wind_speed: number | null;
  wind_direction: number | null;
  wind_compass: string | null;
  activity_name: string | null;
}

function fmt(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtDelta(delta: number): string {
  const abs = Math.abs(delta);
  const sign = delta > 0 ? '+' : '-';
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sign}${m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `0:${s.toString().padStart(2, '0')}`}`;
}

const CLIMB_CATEGORY: Record<number, string> = {
  0: 'NC', 1: '4', 2: '3', 3: '2', 4: '1', 5: 'HC',
};

function windArrow(deg: number): string {
  // Arrow points in the direction the wind is going TO (meteorological convention reversed for display)
  const arrows = ['↓','↙','←','↖','↑','↗','→','↘'];
  return arrows[Math.round(deg / 45) % 8];
}

export default function SegmentDetail({ id }: { id: string }) {
  const [segment,  setSegment]  = useState<Segment | null>(null);
  const [efforts,  setEfforts]  = useState<Effort[]>([]);
  const [segLoad,  setSegLoad]  = useState(true);
  const [effLoad,  setEffLoad]  = useState(true);
  const [error,    setError]    = useState(false);

  useEffect(() => {
    fetch(`/api/segments/${id}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { setSegment(d.segment); setSegLoad(false); })
      .catch(() => { setError(true); setSegLoad(false); });

    fetch(`/api/segments/${id}/efforts`)
      .then(r => r.json())
      .then(d => { setEfforts(d.efforts ?? []); setEffLoad(false); })
      .catch(() => setEffLoad(false));
  }, [id]);

  if (segLoad) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-gray-800 rounded-xl h-24 animate-pulse" />
        ))}
      </div>
    );
  }

  if (error || !segment) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 text-center text-gray-400">
        Segment not found.{' '}
        <Link href="/activities" className="text-orange-400 hover:underline">Back</Link>
      </div>
    );
  }

  const bestTime = efforts.length > 0
    ? Math.min(...efforts.map(e => e.elapsed_time))
    : null;

  const elevDiff =
    segment.elevation_high != null && segment.elevation_low != null
      ? Math.round(segment.elevation_high - segment.elevation_low)
      : null;

  // Build elevation profile data
  const elevData: { dist: number; alt: number }[] = [];
  if (segment.distance_stream && segment.altitude_stream) {
    const step = Math.max(1, Math.floor(segment.distance_stream.length / 200));
    for (let i = 0; i < segment.distance_stream.length; i += step) {
      elevData.push({
        dist: Math.round(segment.distance_stream[i] / 10) / 100, // km with 2dp
        alt:  Math.round(segment.altitude_stream[i]),
      });
    }
    // Always include last point
    const last = segment.distance_stream.length - 1;
    if (elevData[elevData.length - 1]?.dist !== Math.round(segment.distance_stream[last] / 10) / 100) {
      elevData.push({
        dist: Math.round(segment.distance_stream[last] / 10) / 100,
        alt:  Math.round(segment.altitude_stream[last]),
      });
    }
  }

  return (
    <div className="h-full overflow-y-auto scroll-touch">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">

        {/* Back */}
        <Link href="/activities" className="text-sm text-gray-500 hover:text-orange-400 transition-colors">
          ← Activities
        </Link>

        {/* Header */}
        <div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white mb-1">{segment.name}</h1>
              <p className="text-sm text-gray-400">
                Ride Segment
                {segment.city ? ` · ${segment.city}` : ''}
                {segment.country ? `, ${segment.country}` : ''}
              </p>
            </div>
            <a
              href={`https://www.strava.com/segments/${id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 text-xs text-orange-400 hover:text-orange-300 border border-orange-500/30 rounded-lg px-3 py-1.5 transition-colors"
            >
              View on Strava ↗
            </a>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-4">
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Distance</p>
            <p className="text-lg font-bold text-white">{(segment.distance / 1000).toFixed(2)}<span className="text-xs text-gray-400 ml-1">km</span></p>
          </div>
          {segment.total_elevation_gain != null && (
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Elev Gain</p>
              <p className="text-lg font-bold text-white">{Math.round(segment.total_elevation_gain)}<span className="text-xs text-gray-400 ml-1">m</span></p>
            </div>
          )}
          {segment.avg_grade != null && (
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Avg Grade</p>
              <p className="text-lg font-bold text-white">{segment.avg_grade.toFixed(1)}<span className="text-xs text-gray-400 ml-1">%</span></p>
            </div>
          )}
          {segment.elevation_low != null && (
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Lowest Elev</p>
              <p className="text-lg font-bold text-white">{Math.round(segment.elevation_low)}<span className="text-xs text-gray-400 ml-1">m</span></p>
            </div>
          )}
          {segment.elevation_high != null && (
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Highest Elev</p>
              <p className="text-lg font-bold text-white">{Math.round(segment.elevation_high)}<span className="text-xs text-gray-400 ml-1">m</span></p>
            </div>
          )}
          {elevDiff != null && (
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Elev Diff</p>
              <p className="text-lg font-bold text-white">{elevDiff}<span className="text-xs text-gray-400 ml-1">m</span></p>
            </div>
          )}
        </div>

        {/* Secondary stats */}
        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-400">
          {segment.climb_category != null && segment.climb_category > 0 && (
            <span>
              Climb Category <span className="text-white font-semibold">{CLIMB_CATEGORY[segment.climb_category] ?? segment.climb_category}</span>
            </span>
          )}
          {segment.effort_count != null && (
            <span>{segment.effort_count.toLocaleString()} total attempts</span>
          )}
          {segment.athlete_count != null && (
            <span>by {segment.athlete_count.toLocaleString()} athletes</span>
          )}
        </div>

        {/* Map */}
        {segment.polyline && (
          <ActivityMap
            polyline={segment.polyline}
            className="w-full h-64 rounded-xl overflow-hidden bg-gray-800"
          />
        )}

        {/* Elevation profile */}
        {elevData.length > 2 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Elevation Profile</p>
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={elevData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#f97316" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                  <XAxis
                    dataKey="dist"
                    tickFormatter={v => `${v} km`}
                    tick={{ fill: '#6b7280', fontSize: 10 }}
                    axisLine={false} tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tickFormatter={v => `${v} m`}
                    tick={{ fill: '#6b7280', fontSize: 10 }}
                    axisLine={false} tickLine={false}
                    width={48}
                  />
                  <Tooltip
                    contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                    formatter={(val) => [`${val} m`, 'Elevation']}
                    labelFormatter={l => `${l} km`}
                  />
                  <Area
                    type="monotone" dataKey="alt"
                    stroke="#f97316" strokeWidth={2}
                    fill="url(#elevGrad)"
                    dot={false} activeDot={{ r: 3, fill: '#f97316' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Efforts history */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Your Efforts{efforts.length > 0 ? ` (${efforts.length})` : ''}
            </p>
            {bestTime && (
              <span className="text-xs text-gray-500">
                PR <span className="text-yellow-400 font-semibold">{fmt(bestTime)}</span>
              </span>
            )}
          </div>

          {effLoad ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-14 bg-gray-800 rounded-xl animate-pulse" />)}
            </div>
          ) : efforts.length === 0 ? (
            <div className="bg-gray-800/40 rounded-xl p-6 text-center">
              <p className="text-gray-400 text-sm">No recorded efforts on this segment yet.</p>
            </div>
          ) : (
            <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-x-auto scroll-touch">
              <table className="text-sm w-full whitespace-nowrap">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Date</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Time</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">vs PR</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Avg W</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Avg HR</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Max HR</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Wind</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {efforts.map((e, i) => {
                    const isPR    = e.elapsed_time === bestTime;
                    const delta   = bestTime != null ? e.elapsed_time - bestTime : null;
                    const date    = new Date(e.start_date);
                    const isTop3  = e.kom_rank != null && e.kom_rank <= 3;

                    return (
                      <tr
                        key={e.id}
                        className={`border-b border-gray-800/60 last:border-0 ${
                          isPR ? 'bg-yellow-500/8' : i % 2 !== 0 ? 'bg-gray-800/20' : ''
                        }`}
                      >
                        {/* Date */}
                        <td className="px-4 py-3">
                          <div className="text-gray-300">
                            {date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </div>
                          {e.activity_name && (
                            <div className="text-[11px] text-gray-500 truncate max-w-[160px]">{e.activity_name}</div>
                          )}
                        </td>

                        {/* Time */}
                        <td className="px-4 py-3 text-right tabular-nums">
                          <span className={`font-bold ${isPR ? 'text-yellow-300' : 'text-white'}`}>
                            {fmt(e.elapsed_time)}
                          </span>
                          {isPR && (
                            <span className="ml-1.5 text-[10px] bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-1 py-0.5 rounded font-bold">PR</span>
                          )}
                          {isTop3 && !isPR && (
                            <span className="ml-1.5 text-[10px] bg-orange-500/20 text-orange-400 border border-orange-500/30 px-1 py-0.5 rounded font-bold">Top {e.kom_rank}</span>
                          )}
                        </td>

                        {/* vs PR */}
                        <td className="px-4 py-3 text-right tabular-nums text-xs">
                          {delta === 0 ? (
                            <span className="text-yellow-400">—</span>
                          ) : delta != null ? (
                            <span className="text-gray-400">{fmtDelta(delta)}</span>
                          ) : '—'}
                        </td>

                        {/* Avg W */}
                        <td className="px-4 py-3 text-right tabular-nums text-gray-300">
                          {e.average_watts ? (
                            <>{Math.round(e.average_watts)} <span className="text-xs text-gray-500">W</span></>
                          ) : '—'}
                        </td>

                        {/* Avg HR */}
                        <td className="px-4 py-3 text-right tabular-nums text-gray-300">
                          {e.average_heartrate ? (
                            <>{Math.round(e.average_heartrate)} <span className="text-xs text-gray-500">bpm</span></>
                          ) : '—'}
                        </td>

                        {/* Max HR */}
                        <td className="px-4 py-3 text-right tabular-nums text-gray-300">
                          {e.max_heartrate ? (
                            <>{Math.round(e.max_heartrate)} <span className="text-xs text-gray-500">bpm</span></>
                          ) : '—'}
                        </td>

                        {/* Wind */}
                        <td className="px-4 py-3 text-right">
                          {e.wind_speed != null ? (
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-gray-300 tabular-nums">{e.wind_speed}</span>
                              <span className="text-xs text-gray-500">km/h</span>
                              {e.wind_compass && (
                                <span className="text-gray-400 text-xs font-medium">
                                  {windArrow(e.wind_direction!)} {e.wind_compass}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-600 text-xs">—</span>
                          )}
                        </td>

                        {/* Activity link */}
                        <td className="px-4 py-3 text-right">
                          {e.activity_id && (
                            <Link
                              href={`/activities/${e.activity_id}`}
                              className="text-[11px] text-orange-400 hover:text-orange-300 transition-colors"
                            >
                              View →
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
