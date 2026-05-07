'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip,
} from 'recharts';
import { sportLabel, sportColor } from '@/lib/sport-types';
import ZoneDistribution from './ZoneDistribution';
import PowerCurveChart from './PowerCurveChart';
import AerobicEfficiencyChart from './AerobicEfficiencyChart';

const COMPARE_PERIODS = [
  { key: '30d', label: '30d' },
  { key: '60d', label: '60d' },
  { key: '90d', label: '90d' },
  { key: '6m',  label: '6m'  },
  { key: '1y',  label: '1y'  },
  { key: 'all', label: 'All' },
] as const;

type ComparePeriod = typeof COMPARE_PERIODS[number]['key'];

const COMPARE_LABELS: Record<ComparePeriod, string> = {
  '30d': 'Last 30 days',
  '60d': 'Last 60 days',
  '90d': 'Last 90 days',
  '6m':  'Last 6 months',
  '1y':  'Last year',
  'all': 'All time',
};

interface CurveDataPoint { label: string; power: number; }
interface ActivityCurveResponse {
  activity: CurveDataPoint[];
  comparison: CurveDataPoint[] | null;
  ftp: number;
}

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

type Tab = 'stats' | 'laps' | 'power-hr' | 'segments';

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
  gear_id: string | null;
  gear_name: string | null;
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
  const [curvePeriod, setCurvePeriod] = useState<ComparePeriod | 'none'>('none');
  const [curveData,   setCurveData]   = useState<ActivityCurveResponse | null>(null);
  const [curveLoading, setCurveLoading] = useState(false);
  type LapSortKey = 'index' | 'distance' | 'moving_time' | 'average_watts' | 'normalized_power' | 'average_heartrate' | 'max_heartrate';
  const [lapSort, setLapSort] = useState<{ key: LapSortKey; dir: 'asc' | 'desc' }>({ key: 'index', dir: 'asc' });
  const [editingName, setEditingName] = useState(false);
  const [nameDraft,   setNameDraft]   = useState('');

  async function saveName() {
    if (!activity) return;
    const next = nameDraft.trim();
    if (!next || next === activity.name) { setEditingName(false); return; }
    const r = await fetch(`/api/activities/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: next }),
    });
    if (r.ok) setActivity(a => a ? { ...a, name: next } : a);
    setEditingName(false);
  }

  async function renameGear() {
    if (!activity?.gear_id) return;
    const current = activity.gear_name ?? '';
    const next = window.prompt('Rename gear', current);
    if (!next || next.trim() === current) return;
    const r = await fetch(`/api/gear/${encodeURIComponent(activity.gear_id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: next.trim() }),
    });
    if (r.ok) setActivity(a => a ? { ...a, gear_name: next.trim() } : a);
  }

  useEffect(() => {
    fetch(`/api/activities/${id}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { setActivity(d.activity); setLaps(d.laps ?? []); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [id]);

  useEffect(() => {
    if (!activity?.id) return;
    setBpLoading(true);
    setBpResults(undefined);
    const controller = new AbortController();
    fetch(`/api/activities/${id}/best-power?seconds=${bpSeconds}`, { signal: controller.signal })
      .then(r => r.json())
      .then(d => { setBpResults(d.results ?? []); setBpLoading(false); })
      .catch(e => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setBpResults([]); setBpLoading(false);
      });
    return () => controller.abort();
  }, [id, activity?.id, bpSeconds]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab !== 'power-hr' || !activity?.id) return;
    setCurveLoading(true);
    const controller = new AbortController();
    fetch(`/api/activities/${id}/power-curve?compare=${curvePeriod}`, { signal: controller.signal })
      .then(r => r.json())
      .then(d => { setCurveData(d); setCurveLoading(false); })
      .catch(e => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setCurveLoading(false);
      });
    return () => controller.abort();
  }, [tab, id, activity?.id, curvePeriod]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lazy-load segments only when Segments tab is opened
  useEffect(() => {
    if (tab !== 'segments' || segFetched) return;
    setSegLoading(true);
    fetch(`/api/activities/${id}/segments`)
      .then(r => r.json())
      .then(d => { setSegments(d.efforts ?? []); setSegFetched(true); setSegLoading(false); })
      .catch(() => { setSegFetched(true); setSegLoading(false); });
  }, [tab, id, segFetched]);

  if (loading) {
    return (
      <div className="max-w-2xl md:max-w-5xl mx-auto px-4 py-8 space-y-4">
        {[1,2,3].map(i => <div key={i} className="bg-gray-800 rounded-xl h-20 animate-pulse" />)}
      </div>
    );
  }

  if (error || !activity) {
    return (
      <div className="max-w-2xl md:max-w-5xl mx-auto px-4 py-8 text-center text-gray-400">
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
    { key: 'stats',     label: 'Stats' },
    { key: 'laps',      label: `Laps${laps.length ? ` (${laps.length})` : ''}` },
    { key: 'power-hr',  label: 'Power & HR' },
    { key: 'segments',  label: `Segments${segments.length ? ` (${segments.length})` : ''}` },
  ];

  return (
    <div className="h-full overflow-y-auto scroll-touch">
      <div className="max-w-2xl md:max-w-5xl mx-auto px-4 py-6 space-y-5">

        <Link href="/activities" className="text-sm text-gray-500 hover:text-orange-400 transition-colors">
          ← Activities
        </Link>

        {/* Header + Map */}
        <div className="flex gap-4 items-start">
          <div className="flex-1 min-w-0">
            {/* Sport badge + date + gear */}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: color + '20', color }}>
                {sportLabel(activity.sport_type)}{activity.trainer ? ' · Indoor' : ''}
              </span>
              <span className="text-xs text-gray-500">
                {date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                {' · '}
                {date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            {/* Activity name (click to edit) */}
            {editingName ? (
              <input
                autoFocus
                value={nameDraft}
                onChange={e => setNameDraft(e.target.value)}
                onBlur={saveName}
                onKeyDown={e => {
                  if (e.key === 'Enter')  { e.preventDefault(); saveName(); }
                  if (e.key === 'Escape') { setEditingName(false); }
                }}
                className="w-full text-xl font-bold text-white mb-4 leading-tight bg-gray-800 border border-orange-500 rounded-lg px-2 py-1 focus:outline-none"
              />
            ) : (
              <h1
                onClick={() => { setNameDraft(activity.name); setEditingName(true); }}
                className="text-xl font-bold text-white mb-4 leading-tight cursor-text hover:bg-gray-800/40 rounded-lg -mx-2 px-2 py-1 transition-colors group inline-flex items-center gap-2 max-w-full"
                title="Click to rename"
              >
                <span className="truncate">{activity.name}</span>
                <svg className="w-4 h-4 text-gray-600 opacity-0 group-hover:opacity-100 flex-shrink-0 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </h1>
            )}

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
              {activity.gear_name && (
                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Gear</div>
                  <button
                    onClick={renameGear}
                    className="text-base font-bold text-white text-left hover:text-orange-400 transition-colors group inline-flex items-center gap-1.5 max-w-full"
                    title="Click to rename gear"
                  >
                    <span className="truncate">{activity.gear_name}</span>
                    <svg className="w-3 h-3 text-gray-600 opacity-0 group-hover:opacity-100 flex-shrink-0 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Desktop map (side-by-side with stats) */}
          {activity.summary_polyline ? (
            <div className="w-[42%] flex-shrink-0 hidden sm:block">
              <ActivityMap
                polyline={activity.summary_polyline}
                className="w-full h-48 rounded-xl overflow-hidden bg-gray-800"
              />
            </div>
          ) : null}
        </div>

        {/* Get Coach feedback — between top stats and the map */}
        <Link
          href={`/chat?prompt=${encodeURIComponent(`Coach feedback on "${activity.name}" (id ${id}).`)}`}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-orange-500/15 hover:bg-orange-500/25 text-orange-400 text-sm font-semibold transition-colors border border-orange-500/30"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          Get Coach feedback
        </Link>

        {/* Mobile map (full width below the button) */}
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

          // Lap chart data — compute cumulative time for histogram positioning
          let cumTime = 0;
          const lapChartData = sortedLaps.map(lap => {
            const start = cumTime;
            cumTime += lap.moving_time;
            return {
              lap: `L${lap.lap_index}`,
              time: fmt(lap.moving_time),
              timeSec: lap.moving_time,
              startSec: start,
              endSec: cumTime,
              watts: lap.average_watts ? Math.round(lap.average_watts) : 0,
            };
          });
          const maxTime = cumTime;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          function LapTooltip({ active, payload, label }: any) {
            if (!active || !payload?.length) return null;
            const p = payload[0]?.payload;
            if (!p) return null;
            return (
              <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-lg space-y-1">
                <p className="text-gray-400 font-medium">{label}</p>
                <p className="text-gray-500">{p.time}</p>
                <p className="text-orange-400">
                  Avg Power: <span className="font-bold">{p.watts} W</span>
                </p>
              </div>
            );
          }

          // Custom bar shape that draws width proportional to lap duration
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          function DurationBar({ x, y, width, height, payload, fill }: any) {
            if (!payload) return null;
            const barWidth = Math.max(4, (payload.timeSec / maxTime) * width * lapChartData.length * 0.85);
            const centerX = x + width / 2 - barWidth / 2;
            return (
              <rect x={centerX} y={y} width={barWidth} height={height} fill={fill} rx={2} ry={2} opacity={0.8} />
            );
          }

          return (
            <div className="space-y-4">
              {/* Lap performance bar chart */}
              {lapChartData.length > 0 && (
                <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                  <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-3">Lap Performance</p>
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={lapChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="10%">
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                      <XAxis
                        dataKey="lap"
                        tick={{ fill: '#6b7280', fontSize: 9 }}
                        axisLine={false}
                        tickLine={false}
                        label={{ value: 'Lap (duration)', position: 'insideBottomRight', offset: -4, fill: '#6b7280', fontSize: 9 }}
                      />
                      <YAxis
                        domain={[0, dataMax => Math.ceil(dataMax * 1.15)]}
                        tick={{ fill: '#f97316', fontSize: 9 }}
                        axisLine={false}
                        tickLine={false}
                        width={32}
                        tickFormatter={v => `${v}W`}
                      />
                      <Tooltip content={<LapTooltip />} cursor={{ fill: '#374151', fillOpacity: 0.2 }} />
                      <Bar dataKey="watts" fill="#f97316" shape={<DurationBar />} />
                    </BarChart>
                  </ResponsiveContainer>
                  <p className="text-[10px] text-gray-600 mt-2">
                    <span className="text-orange-400">■</span> Avg Power (W) — bar width reflects lap duration
                  </p>
                </div>
              )}

              {/* Lap table */}
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
            </div>
          );
        })()}

        {/* Tab: Power & HR */}
        {tab === 'power-hr' && (
          <div className="space-y-6">
            {/* ── Power section ── */}
            {activity.average_watts ? (
              <div className="space-y-4">

                {/* Power Curve */}
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Power Curve</p>
                    {curvePeriod !== 'none' && (
                      <button
                        onClick={() => setCurvePeriod('none')}
                        className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
                      >
                        Clear compare
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-600">Compare vs:</span>
                    {COMPARE_PERIODS.map(p => (
                      <button
                        key={p.key}
                        onClick={() => setCurvePeriod(prev => prev === p.key ? 'none' : p.key)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
                          curvePeriod === p.key
                            ? 'bg-blue-500/20 text-blue-400 border-blue-500/50'
                            : 'bg-gray-800 text-gray-500 hover:text-gray-300 border-transparent'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  {curveLoading ? (
                    <div className="h-52 bg-gray-800/60 rounded-xl animate-pulse" />
                  ) : curveData && curveData.activity.length > 0 ? (
                    <>
                      <PowerCurveChart
                        data={curveData.activity}
                        compareData={curveData.comparison}
                        compareLabel={curvePeriod !== 'none' ? COMPARE_LABELS[curvePeriod as ComparePeriod] : undefined}
                        ftp={curveData.ftp}
                      />
                      {curveData.comparison && curvePeriod !== 'none' && (
                        <p className="text-[10px] text-gray-600">
                          <span className="text-orange-400">—</span> This ride &nbsp;
                          <span className="text-gray-500">- -</span> {COMPARE_LABELS[curvePeriod as ComparePeriod]}
                        </p>
                      )}
                    </>
                  ) : curveData ? (
                    <div className="h-40 flex items-center justify-center text-gray-600 text-sm">
                      No power stream data for this activity
                    </div>
                  ) : null}
                </div>

                {/* Best Efforts */}
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Best Efforts</p>
                  <Link
                    href={`/performance?tab=power&s=${bpSeconds}`}
                    className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
                  >
                    All activities →
                  </Link>
                </div>

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
            )}

            {/* ── Aerobic Efficiency section ── */}
            <AerobicEfficiencyChart activityId={id} />

            {/* ── Time in Zones section ── */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Time in Zones</p>
              <ZoneDistribution activityId={id} />
            </div>
          </div>
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
