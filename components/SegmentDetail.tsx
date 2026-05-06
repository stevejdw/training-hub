'use client';

import { useEffect, useState, useMemo } from 'react';
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

type SortKey = 'start_date' | 'elapsed_time' | 'average_watts' | 'average_heartrate' | 'max_heartrate' | 'wind_speed';
type SortDir = 'asc' | 'desc';

interface Filters {
  dateFrom:  string;
  dateTo:    string;
  timeMin:   string;  // mm:ss or m:ss
  timeMax:   string;
  powerMin:  string;
  powerMax:  string;
}

const EMPTY_FILTERS: Filters = { dateFrom: '', dateTo: '', timeMin: '', timeMax: '', powerMin: '', powerMax: '' };

function fmt(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m}:${s.toString().padStart(2, '0')}`;
}

/** Parse "m:ss" or "mm:ss" or "h:mm:ss" to seconds. Returns null if unparseable. */
function parseTime(str: string): number | null {
  if (!str.trim()) return null;
  const parts = str.trim().split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function activeFilterCount(f: Filters): number {
  return [f.dateFrom, f.dateTo, f.timeMin, f.timeMax, f.powerMin, f.powerMax].filter(Boolean).length;
}

const CLIMB_CATEGORY: Record<number, string> = {
  0: 'NC', 1: '4', 2: '3', 3: '2', 4: '1', 5: 'HC',
};

function windArrow(deg: number): string {
  const arrows = ['↓','↙','←','↖','↑','↗','→','↘'];
  return arrows[Math.round(deg / 45) % 8];
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <span className="ml-1 text-gray-700">↕</span>;
  return <span className="ml-1 text-orange-400">{sortDir === 'asc' ? '↑' : '↓'}</span>;
}

/** Placing badge — always reflects time-based rank in the full effort set. */
function PlaceBadge({ rank }: { rank: number }) {
  if (rank === 1) return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-yellow-500/20 text-yellow-400 text-[10px] font-bold border border-yellow-500/40">1</span>
  );
  if (rank === 2) return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-400/15 text-gray-300 text-[10px] font-bold border border-gray-500/30">2</span>
  );
  if (rank === 3) return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-orange-700/20 text-orange-400 text-[10px] font-bold border border-orange-700/30">3</span>
  );
  if (rank <= 10) return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-500/10 text-green-400 text-[10px] font-bold border border-green-500/20">{rank}</span>
  );
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 text-gray-600 text-[10px] tabular-nums">{rank}</span>
  );
}

function rowBg(rank: number, isAlt: boolean): string {
  if (rank === 1) return 'bg-yellow-500/5';
  if (rank <= 3)  return 'bg-orange-500/5';
  if (rank <= 10) return 'bg-green-500/4';
  return isAlt ? 'bg-gray-800/20' : '';
}

export default function SegmentDetail({ id }: { id: string }) {
  const [segment,   setSegment]   = useState<Segment | null>(null);
  const [efforts,   setEfforts]   = useState<Effort[]>([]);
  const [segLoad,   setSegLoad]   = useState(true);
  const [effLoad,   setEffLoad]   = useState(true);
  const [error,     setError]     = useState(false);
  const [sortKey,   setSortKey]   = useState<SortKey>('elapsed_time');
  const [sortDir,   setSortDir]   = useState<SortDir>('asc');
  const [remaining, setRemaining] = useState(0);
  const [debug,     setDebug]     = useState<Record<string, unknown> | null>(null);
  const [filters,   setFilters]   = useState<Filters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    fetch(`/api/segments/${id}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { setSegment(d.segment); setSegLoad(false); })
      .catch(() => { setError(true); setSegLoad(false); });

    fetch(`/api/segments/${id}/efforts`)
      .then(r => r.json())
      .then(d => {
        setEfforts(d.efforts ?? []);
        setRemaining(d.remaining ?? 0);
        setDebug(d.error ? { error: d.error } : (d.debug ?? null));
        setEffLoad(false);
      })
      .catch(err => { setDebug({ fetch_error: String(err) }); setEffLoad(false); });
  }, [id]);

  // Time-based rank map: effortId → rank (1 = fastest, all efforts unfiltered)
  const timeRankMap = useMemo(() => {
    const sorted = [...efforts].sort((a, b) => a.elapsed_time - b.elapsed_time);
    const map: Record<number, number> = {};
    sorted.forEach((e, i) => { map[e.id] = i + 1; });
    return map;
  }, [efforts]);

  const sorted = useMemo(() => {
    return [...efforts].sort((a, b) => {
      let av: number | string | null = null;
      let bv: number | string | null = null;
      if (sortKey === 'start_date') {
        av = a.start_date; bv = b.start_date;
      } else {
        av = a[sortKey]; bv = b[sortKey];
      }
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [efforts, sortKey, sortDir]);

  const filtered = useMemo(() => {
    const minSec  = parseTime(filters.timeMin);
    const maxSec  = parseTime(filters.timeMax);
    const minW    = filters.powerMin ? Number(filters.powerMin) : null;
    const maxW    = filters.powerMax ? Number(filters.powerMax) : null;
    return sorted.filter(e => {
      if (filters.dateFrom && e.start_date.slice(0, 10) < filters.dateFrom) return false;
      if (filters.dateTo   && e.start_date.slice(0, 10) > filters.dateTo)   return false;
      if (minSec !== null && e.elapsed_time < minSec) return false;
      if (maxSec !== null && e.elapsed_time > maxSec) return false;
      if (minW !== null && (e.average_watts == null || e.average_watts < minW)) return false;
      if (maxW !== null && (e.average_watts == null || e.average_watts > maxW)) return false;
      return true;
    });
  }, [sorted, filters]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'elapsed_time' ? 'asc' : 'desc');
    }
  }

  function setFilter<K extends keyof Filters>(key: K, value: string) {
    setFilters(f => ({ ...f, [key]: value }));
  }

  const bestTime   = efforts.length > 0 ? Math.min(...efforts.map(e => e.elapsed_time)) : null;
  const filterCount = activeFilterCount(filters);

  if (segLoad) {
    return (
      <div className="max-w-2xl md:max-w-5xl mx-auto px-4 py-8 space-y-4">
        {[1, 2, 3].map(i => <div key={i} className="bg-gray-800 rounded-xl h-24 animate-pulse" />)}
      </div>
    );
  }

  if (error || !segment) {
    return (
      <div className="max-w-2xl md:max-w-5xl mx-auto px-4 py-8 text-center text-gray-400">
        Segment not found.{' '}
        <Link href="/activities" className="text-orange-400 hover:underline">Back</Link>
      </div>
    );
  }

  const elevDiff =
    segment.elevation_high != null && segment.elevation_low != null
      ? Math.round(segment.elevation_high - segment.elevation_low)
      : null;

  const elevData: { dist: number; alt: number }[] = [];
  if (segment.distance_stream && segment.altitude_stream) {
    const step = Math.max(1, Math.floor(segment.distance_stream.length / 200));
    for (let i = 0; i < segment.distance_stream.length; i += step) {
      elevData.push({
        dist: Math.round(segment.distance_stream[i] / 10) / 100,
        alt:  Math.round(segment.altitude_stream[i]),
      });
    }
    const last = segment.distance_stream.length - 1;
    const lastDist = Math.round(segment.distance_stream[last] / 10) / 100;
    if (elevData[elevData.length - 1]?.dist !== lastDist) {
      elevData.push({ dist: lastDist, alt: Math.round(segment.altitude_stream[last]) });
    }
  }

  const thClass = "px-3 py-3 text-gray-500 font-medium cursor-pointer select-none hover:text-gray-300 transition-colors whitespace-nowrap";

  return (
    <div className="h-full overflow-y-auto scroll-touch">
      <div className="max-w-2xl md:max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* Back */}
        <Link href="/activities" className="text-sm text-gray-500 hover:text-orange-400 transition-colors">
          ← Activities
        </Link>

        {/* Header */}
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
            Strava ↗
          </a>
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
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Lowest</p>
              <p className="text-lg font-bold text-white">{Math.round(segment.elevation_low)}<span className="text-xs text-gray-400 ml-1">m</span></p>
            </div>
          )}
          {segment.elevation_high != null && (
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Highest</p>
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

        {/* Secondary info */}
        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-400">
          {segment.climb_category != null && segment.climb_category > 0 && (
            <span>Cat <span className="text-white font-semibold">{CLIMB_CATEGORY[segment.climb_category] ?? segment.climb_category}</span></span>
          )}
          {segment.effort_count != null && (
            <span>{segment.effort_count.toLocaleString()} total attempts</span>
          )}
          {segment.athlete_count != null && (
            <span>{segment.athlete_count.toLocaleString()} athletes</span>
          )}
          {bestTime && (
            <span>Your PR <span className="text-yellow-400 font-semibold">{fmt(bestTime)}</span></span>
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
              <ResponsiveContainer width="100%" height={140}>
                <AreaChart data={elevData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#f97316" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                  <XAxis dataKey="dist" tickFormatter={v => `${v}km`} tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tickFormatter={v => `${v}m`} tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip
                    contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                    formatter={(val) => [`${val} m`, 'Elevation']}
                    labelFormatter={l => `${l} km`}
                  />
                  <Area type="monotone" dataKey="alt" stroke="#f97316" strokeWidth={2} fill="url(#elevGrad)" dot={false} activeDot={{ r: 3, fill: '#f97316' }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Efforts table */}
        <div>
          {/* Header row */}
          <div className="flex items-center justify-between mb-3 gap-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {effLoad ? 'Loading efforts…' : (
                <>
                  Your Efforts ({filtered.length}{filtered.length !== efforts.length ? `/${efforts.length}` : ''})
                </>
              )}
            </p>
            {!effLoad && efforts.length > 0 && (
              <button
                onClick={() => setShowFilters(f => !f)}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                  showFilters || filterCount > 0
                    ? 'bg-orange-500/15 text-orange-400 border-orange-500/40'
                    : 'bg-gray-800 text-gray-500 border-gray-700 hover:text-gray-300'
                }`}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
                </svg>
                Filter
                {filterCount > 0 && (
                  <span className="bg-orange-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                    {filterCount}
                  </span>
                )}
              </button>
            )}
          </div>

          {/* Filter panel */}
          {showFilters && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {/* Date range */}
                <div className="col-span-2">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Date range</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] text-gray-600 block mb-1">From</label>
                      <input
                        type="date"
                        value={filters.dateFrom}
                        onChange={e => setFilter('dateFrom', e.target.value)}
                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-orange-500"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-gray-600 block mb-1">To</label>
                      <input
                        type="date"
                        value={filters.dateTo}
                        onChange={e => setFilter('dateTo', e.target.value)}
                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-orange-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Time range */}
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Time range</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] text-gray-600 block mb-1">Min (m:ss)</label>
                      <input
                        type="text"
                        value={filters.timeMin}
                        onChange={e => setFilter('timeMin', e.target.value)}
                        placeholder="e.g. 4:30"
                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-orange-500"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-gray-600 block mb-1">Max (m:ss)</label>
                      <input
                        type="text"
                        value={filters.timeMax}
                        onChange={e => setFilter('timeMax', e.target.value)}
                        placeholder="e.g. 6:00"
                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-orange-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Power range */}
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Power range (W)</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] text-gray-600 block mb-1">Min</label>
                      <input
                        type="number"
                        value={filters.powerMin}
                        onChange={e => setFilter('powerMin', e.target.value)}
                        placeholder="e.g. 250"
                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-orange-500"
                        min={0}
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-gray-600 block mb-1">Max</label>
                      <input
                        type="number"
                        value={filters.powerMax}
                        onChange={e => setFilter('powerMax', e.target.value)}
                        placeholder="e.g. 350"
                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-orange-500"
                        min={0}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {filterCount > 0 && (
                <button
                  onClick={() => setFilters(EMPTY_FILTERS)}
                  className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Clear all filters
                </button>
              )}
            </div>
          )}

          {effLoad ? (
            <div className="space-y-2">
              {[1,2,3,4,5].map(i => <div key={i} className="h-12 bg-gray-800 rounded-xl animate-pulse" />)}
            </div>
          ) : efforts.length === 0 ? (
            <div className="bg-gray-800/40 rounded-xl p-6 text-center space-y-3">
              <p className="text-gray-400 text-sm">No efforts found yet.</p>
              {remaining > 0 && (
                <p className="text-gray-500 text-xs">{remaining} activities still need to be scanned.</p>
              )}
              <button
                onClick={() => {
                  setEffLoad(true);
                  fetch(`/api/segments/${id}/efforts`, { method: 'POST' })
                    .then(r => r.json())
                    .then(d => { setEfforts(d.efforts ?? []); setRemaining(d.remaining ?? 0); setDebug(d.debug ?? null); setEffLoad(false); })
                    .catch(() => setEffLoad(false));
                }}
                className="text-xs text-orange-400 hover:text-orange-300 border border-orange-500/30 rounded px-3 py-1.5 transition-colors"
              >
                Scan activity history
              </button>
              {debug && (
                <pre className="text-left text-xs text-gray-400 bg-gray-900 rounded p-3 overflow-auto max-h-48 mt-2">
                  {JSON.stringify(debug, null, 2)}
                </pre>
              )}
            </div>
          ) : (
            <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-x-auto scroll-touch">
              <table className="text-sm w-full whitespace-nowrap">
                <thead>
                  <tr className="border-b border-gray-800">
                    {/* Placing */}
                    <th className="px-3 py-3 text-gray-500 font-medium text-center w-8">#</th>
                    <th className={`text-left ${thClass}`} onClick={() => toggleSort('start_date')}>
                      Date <SortIcon col="start_date" sortKey={sortKey} sortDir={sortDir} />
                    </th>
                    <th className={`text-right ${thClass}`} onClick={() => toggleSort('elapsed_time')}>
                      Time <SortIcon col="elapsed_time" sortKey={sortKey} sortDir={sortDir} />
                    </th>
                    <th className={`text-right ${thClass}`} onClick={() => toggleSort('average_watts')}>
                      Power <SortIcon col="average_watts" sortKey={sortKey} sortDir={sortDir} />
                    </th>
                    <th className={`text-right ${thClass}`} onClick={() => toggleSort('average_heartrate')}>
                      Avg HR <SortIcon col="average_heartrate" sortKey={sortKey} sortDir={sortDir} />
                    </th>
                    <th className={`text-right ${thClass}`} onClick={() => toggleSort('max_heartrate')}>
                      Max HR <SortIcon col="max_heartrate" sortKey={sortKey} sortDir={sortDir} />
                    </th>
                    <th className={`text-right ${thClass}`} onClick={() => toggleSort('wind_speed')}>
                      Wind <SortIcon col="wind_speed" sortKey={sortKey} sortDir={sortDir} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e, rowIdx) => {
                    const rank  = timeRankMap[e.id] ?? 999;
                    const isPR  = e.elapsed_time === bestTime;
                    const date  = new Date(e.start_date);
                    const isTop = e.kom_rank != null && e.kom_rank <= 3;

                    return (
                      <tr
                        key={e.id}
                        onClick={() => e.activity_id && (window.location.href = `/activities/${e.activity_id}`)}
                        className={`border-b border-gray-800/60 last:border-0 cursor-pointer transition-colors hover:bg-gray-800/60 ${rowBg(rank, rowIdx % 2 !== 0)}`}
                      >
                        {/* Placing */}
                        <td className="px-3 py-3 text-center">
                          <PlaceBadge rank={rank} />
                        </td>

                        {/* Date */}
                        <td className="px-3 py-3 text-gray-300 text-left">
                          {date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>

                        {/* Time */}
                        <td className="px-3 py-3 text-right tabular-nums">
                          <span className={`font-bold ${rank === 1 ? 'text-yellow-300' : rank <= 3 ? 'text-orange-300' : 'text-white'}`}>
                            {fmt(e.elapsed_time)}
                          </span>
                          {isPR && (
                            <span className="ml-1.5 text-[10px] bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-1 py-0.5 rounded font-bold">PR</span>
                          )}
                          {isTop && !isPR && (
                            <span className="ml-1.5 text-[10px] bg-orange-500/20 text-orange-400 border border-orange-500/30 px-1 py-0.5 rounded font-bold">Top {e.kom_rank}</span>
                          )}
                        </td>

                        {/* Power */}
                        <td className="px-3 py-3 text-right tabular-nums text-gray-300">
                          {e.average_watts
                            ? <>{Math.round(e.average_watts)}<span className="text-xs text-gray-500 ml-0.5">W</span></>
                            : <span className="text-gray-600">—</span>}
                        </td>

                        {/* Avg HR */}
                        <td className="px-3 py-3 text-right tabular-nums text-gray-300">
                          {e.average_heartrate
                            ? <>{Math.round(e.average_heartrate)}<span className="text-xs text-gray-500 ml-0.5">bpm</span></>
                            : <span className="text-gray-600">—</span>}
                        </td>

                        {/* Max HR */}
                        <td className="px-3 py-3 text-right tabular-nums text-gray-300">
                          {e.max_heartrate
                            ? <>{Math.round(e.max_heartrate)}<span className="text-xs text-gray-500 ml-0.5">bpm</span></>
                            : <span className="text-gray-600">—</span>}
                        </td>

                        {/* Wind */}
                        <td className="px-3 py-3 text-right">
                          {e.wind_speed != null ? (
                            <span className="text-gray-300 tabular-nums">
                              {e.wind_speed}<span className="text-xs text-gray-500 ml-0.5">km/h</span>
                              {e.wind_compass && (
                                <span className="ml-1.5 text-gray-400 text-xs">
                                  {windArrow(e.wind_direction!)} {e.wind_compass}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {filtered.length === 0 && filterCount > 0 && (
                <div className="py-8 text-center text-gray-500 text-sm">
                  No efforts match your filters.{' '}
                  <button onClick={() => setFilters(EMPTY_FILTERS)} className="text-orange-400 hover:text-orange-300 transition-colors">Clear</button>
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
