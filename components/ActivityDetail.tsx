'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { sportLabel, sportColor } from '@/lib/sport-types';
import ZoneDistribution from './ZoneDistribution';
import PowerCurveChart from './PowerCurveChart';
import AerobicEfficiencyChart from './AerobicEfficiencyChart';
import StreamCharts from './desktop/StreamCharts';
import ActivityEditModal from './ActivityEditModal';
import { useIsDesktop } from './desktop/useIsDesktop';
import { CHART } from '@/lib/chart-theme';

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
  power_meter: string | null;
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
    <div className="flex justify-between items-baseline py-2.5 border-b border-line last:border-0">
      <span className="text-sm text-ink-3">{label}</span>
      <span className="text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}

export default function ActivityDetail(
  { id, segmentsEnabled = true }: { id: string; segmentsEnabled?: boolean }
) {
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
  const [hoverPoint,  setHoverPoint]  = useState<[number, number] | null>(null);
  const [editing,     setEditing]     = useState(false);
  const isDesktop = useIsDesktop();
  const router = useRouter();

  /** After a power/HR removal, re-read the activity so every panel clears. */
  async function reloadAfterDataRemoval() {
    const d = await fetch(`/api/activities/${id}`).then(x => x.json());
    setActivity(d.activity);
    setLaps(d.laps ?? []);
    setBpResults([]);
    setCurveData(null);
    setSegments([]);
    setSegFetched(false);
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
    if (!segmentsEnabled || tab !== 'segments' || segFetched) return;
    setSegLoading(true);
    fetch(`/api/activities/${id}/segments`)
      .then(r => r.json())
      .then(d => { setSegments(d.efforts ?? []); setSegFetched(true); setSegLoading(false); })
      .catch(() => { setSegFetched(true); setSegLoading(false); });
  }, [tab, id, segFetched]);

  if (loading) {
    return (
      <div className="max-w-2xl md:max-w-5xl xl:max-w-7xl mx-auto px-4 py-8 space-y-4">
        {[1,2,3].map(i => <div key={i} className="bg-raised rounded-xl h-20 animate-pulse" />)}
      </div>
    );
  }

  if (error || !activity) {
    return (
      <div className="max-w-2xl md:max-w-5xl xl:max-w-7xl mx-auto px-4 py-8 text-center text-ink-3">
        Activity not found.{' '}
        <Link href="/activities" className="text-accent-hi hover:underline">Back to activities</Link>
      </div>
    );
  }

  const date   = new Date(activity.start_date);
  const color  = sportColor(activity.sport_type);
  const np     = activity.normalized_power ?? activity.weighted_average_watts;
  const speedKph = activity.average_speed ? (activity.average_speed * 3.6).toFixed(1) : null;

  const hasPower = activity.average_watts != null || activity.normalized_power != null || activity.max_watts != null;
  const hasHr    = activity.average_heartrate != null || activity.max_heartrate != null;

  const TABS: { key: Tab; label: string }[] = [
    { key: 'stats',     label: 'Stats' },
    { key: 'laps',      label: `Laps${laps.length ? ` (${laps.length})` : ''}` },
    { key: 'power-hr',  label: 'Power & HR' },
    // Strava-only concept; hidden when Garmin is the primary source.
    ...(segmentsEnabled
      ? [{ key: 'segments' as const, label: `Segments${segments.length ? ` (${segments.length})` : ''}` }]
      : []),
  ];

  // Back link on the left, Edit on the right — every mutation (rename, gear,
  // removing power/HR, deleting) lives behind this one button.
  const backLink = (
    <div className="flex items-center justify-between gap-3">
      <Link href="/activities" className="text-sm text-ink-4 hover:text-accent-hi transition-colors">
        ← Activities
      </Link>
      <button
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line-strong bg-raised/60 hover:bg-hover text-ink-2 hover:text-ink text-sm font-medium transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        Edit
      </button>
    </div>
  );

  const editModal = editing ? (
    <ActivityEditModal
      activityId={id}
      name={activity.name}
      startDate={activity.start_date}
      gearId={activity.gear_id}
      hasPower={hasPower}
      hasHr={hasHr}
      onClose={() => setEditing(false)}
      onSaved={patch => setActivity(a => a ? { ...a, ...patch } : a)}
      onDataRemoved={reloadAfterDataRemoval}
      onActivityDeleted={() => { router.replace('/activities'); router.refresh(); }}
    />
  ) : null;

  const headerInner = (
          <div className="flex-1 min-w-0">
            {/* Sport badge + date + gear */}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: color + '20', color }}>
                {sportLabel(activity.sport_type)}{activity.trainer ? ' · Indoor' : ''}
              </span>
              <span className="text-xs text-ink-4">
                {date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
                {' · '}
                {date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            <h1 className="text-xl font-bold text-ink mb-4 leading-tight truncate">{activity.name}</h1>

            {/* Key stats strip */}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              {activity.distance > 0 && (
                <div>
                  <div className="text-micro text-ink-4 uppercase tracking-wider mb-0.5">Distance</div>
                  <div className="text-base font-bold text-ink">{(activity.distance / 1000).toFixed(2)}<span className="text-xs text-ink-3 ml-1">km</span></div>
                </div>
              )}
              {speedKph && (
                <div>
                  <div className="text-micro text-ink-4 uppercase tracking-wider mb-0.5">Avg Speed</div>
                  <div className="text-base font-bold text-ink">{speedKph}<span className="text-xs text-ink-3 ml-1">km/h</span></div>
                </div>
              )}
              {activity.average_watts && (
                <div>
                  <div className="text-micro text-ink-4 uppercase tracking-wider mb-0.5">Avg Power</div>
                  <div className="text-base font-bold text-ink">{Math.round(activity.average_watts)}<span className="text-xs text-ink-3 ml-1">W</span></div>
                </div>
              )}
              <div>
                <div className="text-micro text-ink-4 uppercase tracking-wider mb-0.5">Time</div>
                <div className="text-base font-bold text-ink">{fmt(activity.moving_time)}</div>
              </div>
              {activity.total_elevation_gain > 0 && (
                <div>
                  <div className="text-micro text-ink-4 uppercase tracking-wider mb-0.5">Ascent</div>
                  <div className="text-base font-bold text-ink">{Math.round(activity.total_elevation_gain)}<span className="text-xs text-ink-3 ml-1">m</span></div>
                </div>
              )}
              {activity.gear_name && (
                <div>
                  <div className="text-micro text-ink-4 uppercase tracking-wider mb-0.5">Bike</div>
                  {/* Wraps rather than truncates: gear names mirror Garmin now,
                      and 'Specialized Tarmac SL7' does not fit one grid cell. */}
                  <div className="text-base font-bold text-ink leading-tight break-words" title={activity.gear_name}>{activity.gear_name}</div>
                </div>
              )}
              {activity.power_meter && (
                <div>
                  <div className="text-micro text-ink-4 uppercase tracking-wider mb-0.5">Power Meter</div>
                  <div className="text-base font-bold text-blue-400">{activity.power_meter}</div>
                </div>
              )}
            </div>
          </div>
  );

  const coachLink = (
        <Link
          href={`/chat?prompt=${encodeURIComponent(`Coach feedback on "${activity.name}" (id ${id}).`)}`}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-accent/15 hover:bg-accent/25 text-accent-hi text-sm font-semibold transition-colors border border-accent/30"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          Get Coach feedback
        </Link>
  );

  const tabsNav = (
        <div className="border-b border-line">
          <div className="flex items-center gap-0">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  tab === t.key
                    ? 'border-accent text-ink'
                    : 'border-transparent text-ink-4 hover:text-ink-2'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
  );


  const tabPanels = (
    <>
        {/* Tab: Stats */}
        {tab === 'stats' && (
          <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
            <div>
              <p className="text-xs font-semibold text-ink-4 uppercase tracking-wider mb-1">Performance</p>
              <StatRow label="Moving Time"    value={fmt(activity.moving_time)} />
              <StatRow label="Elapsed Time"   value={fmt(activity.elapsed_time)} />
              <StatRow label="Distance"       value={activity.distance > 0 ? `${(activity.distance / 1000).toFixed(2)} km` : null} />
              <StatRow label="Avg Speed"      value={speedKph ? `${speedKph} km/h` : null} />
              <StatRow label="Elevation"      value={activity.total_elevation_gain > 0 ? `${Math.round(activity.total_elevation_gain)} m` : null} />
              <StatRow label="TSS"            value={activity.tss !== null ? Math.round(activity.tss) : null} />
              <StatRow label="Suffer Score"   value={activity.suffer_score} />
            </div>
            <div className="mt-6 sm:mt-0">
              <p className="text-xs font-semibold text-ink-4 uppercase tracking-wider mb-1">Power & HR</p>
              <StatRow label="Avg Power"      value={activity.average_watts ? `${Math.round(activity.average_watts)} W` : null} />
              <StatRow label="Norm. Power"    value={np ? `${Math.round(np)} W` : null} />
              <StatRow label="Max Power"      value={activity.max_watts ? `${Math.round(activity.max_watts)} W` : null} />
              <StatRow label="Intensity Factor" value={activity.intensity_factor ? activity.intensity_factor.toFixed(2) : null} />
              <StatRow label="Energy"         value={activity.kilojoules ? `${Math.round(activity.kilojoules)} kJ` : null} />
              <StatRow label="Avg Heart Rate" value={activity.average_heartrate ? `${Math.round(activity.average_heartrate)} bpm` : null} />
              <StatRow label="Max Heart Rate" value={activity.max_heartrate ? `${Math.round(activity.max_heartrate)} bpm` : null} />
            </div>
          </div>
          </>
        )}

        {/* Tab: Laps */}
        {tab === 'laps' && (() => {
          if (laps.length === 0) return (
            <div className="bg-raised/50 border border-line-strong border-dashed rounded-xl p-8 text-center">
              <p className="text-ink-4 text-sm">No lap data for this activity</p>
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
                  ${active ? 'text-accent-hi' : 'text-ink-4 hover:text-ink-2'}`}
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

          // Lap histogram data — compute cumulative time for true time-based histogram
          let cumSec = 0;
          const maxWatts = Math.max(...sortedLaps.map(l => l.average_watts ?? 0), 1);
          const totalSec = sortedLaps.reduce((s, l) => s + l.moving_time, 0) || 1;
          const barData = sortedLaps.map(lap => {
            const start = cumSec;
            const duration = lap.moving_time;
            cumSec += duration;
            return {
              label: `L${lap.lap_index}`,
              timeStr: fmt(duration),
              durationSec: duration,
              startSec: start,
              endSec: cumSec,
              watts: lap.average_watts ? Math.round(lap.average_watts) : 0,
            };
          });

          // SVG histogram dimensions
          const svgW = 800, svgH = 170;
          const pad = { top: 8, right: 8, bottom: 22, left: 36 };
          const chartW = svgW - pad.left - pad.right;
          const chartH = svgH - pad.top - pad.bottom;
          const yMax = Math.ceil(maxWatts * 1.15) || 1;

          // Y-axis ticks (5 evenly spaced)
          const yTicks = [0, 1, 2, 3, 4].map(i => Math.round((i * yMax) / 4));

          // X-axis time labels — show elapsed time at regular intervals
          const xTickCount = 8;
          const xTicks = Array.from({ length: xTickCount }, (_, i) =>
            Math.round((i * totalSec) / (xTickCount - 1))
          );

          function fmtShort(sec: number) {
            const m = Math.floor(sec / 60);
            const s = sec % 60;
            return s === 0 ? `${m}m` : `${m}m ${s}s`;
          }

          return (
            <div className="space-y-4">
              {/* Lap performance histogram */}
              {barData.length > 0 && (
                <div className="bg-surface rounded-xl border border-line p-4">
                  <p className="text-mini text-ink-4 uppercase tracking-wider mb-3">Lap Performance</p>
                  <div className="relative" style={{ aspectRatio: String(svgW) + '/' + String(svgH) }}>
                    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-full overflow-visible">
                      {/* Horizontal grid lines */}
                      {yTicks.map(v => {
                        const y = pad.top + chartH - (v / yMax) * chartH;
                        return (
                          <g key={v}>
                            <line x1={pad.left} y1={y} x2={pad.left + chartW} y2={y} stroke={CHART.grid} strokeWidth={1} />
                            <text x={pad.left - 4} y={y + 3} textAnchor="end" fill={CHART.power} fontSize={10}>
                              {v}W
                            </text>
                          </g>
                        );
                      })}

                      {/* X-axis time labels */}
                      {xTicks.map(t => {
                        const x = pad.left + (t / totalSec) * chartW;
                        return (
                          <text key={t} x={x} y={svgH - 4} textAnchor="middle" fill={CHART.axisText} fontSize={9}>
                            {fmtShort(t)}
                          </text>
                        );
                      })}

                      {/* Bars — width exactly proportional to lap duration, no gaps */}
                      {barData.map((b, i) => {
                        const x = pad.left + (b.startSec / totalSec) * chartW;
                        const barW = Math.max(2, (b.durationSec / totalSec) * chartW);
                        const barH = (b.watts / yMax) * chartH;
                        const y = pad.top + chartH - barH;
                        return (
                          <g key={i}>
                            <rect
                              x={x}
                              y={y}
                              width={barW}
                              height={barH}
                              fill={CHART.power}
                              opacity={0.85}
                              rx={1}
                            >
                              <title>{b.label} · {b.timeStr} · Avg Power: {b.watts} W</title>
                            </rect>
                          </g>
                        );
                      })}

                      {/* Bottom axis line */}
                      <line x1={pad.left} y1={pad.top + chartH} x2={pad.left + chartW} y2={pad.top + chartH} stroke={CHART.axis} strokeWidth={1} />
                    </svg>
                  </div>
                  <p className="text-micro text-ink-5 mt-2">
                    <span className="text-accent-hi">■</span> Avg Power (W) — bar width = lap duration, no gaps
                  </p>
                </div>
              )}

              {/* Lap table */}
              <div className="bg-surface rounded-xl overflow-x-auto scroll-touch border border-line">
                <table className="text-sm whitespace-nowrap w-full">
                  <thead>
                    <tr className="border-b border-line">
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
                      <tr key={lap.id} className={`border-b border-line/60 ${i % 2 === 0 ? '' : 'bg-raised/30'}`}>
                        <td className="px-4 py-2.5 text-ink-3">{lap.lap_index}</td>
                        <td className="px-4 py-2.5 text-right text-ink-2">
                          {lap.distance > 0 ? `${(lap.distance / 1000).toFixed(2)} km` : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right text-ink-2">{fmt(lap.moving_time)}</td>
                        <td className="px-4 py-2.5 text-right text-ink font-medium">
                          {lap.average_watts ? Math.round(lap.average_watts) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right text-ink-2">
                          {lap.normalized_power ? Math.round(lap.normalized_power) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right text-ink-2">
                          {lap.average_heartrate ? Math.round(lap.average_heartrate) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right text-ink-2">
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
                <div className="bg-surface border border-line rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-ink-4 uppercase tracking-wider">Power Curve</p>
                    {curvePeriod !== 'none' && (
                      <button
                        onClick={() => setCurvePeriod('none')}
                        className="text-xs text-ink-5 hover:text-ink-3 transition-colors"
                      >
                        Clear compare
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-ink-5">Compare vs:</span>
                    {COMPARE_PERIODS.map(p => (
                      <button
                        key={p.key}
                        onClick={() => setCurvePeriod(prev => prev === p.key ? 'none' : p.key)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
                          curvePeriod === p.key
                            ? 'bg-blue-500/20 text-blue-400 border-blue-500/50'
                            : 'bg-raised text-ink-4 hover:text-ink-2 border-transparent'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  {curveLoading ? (
                    <div className="h-52 bg-raised/60 rounded-xl animate-pulse" />
                  ) : curveData && curveData.activity.length > 0 ? (
                    <>
                      <PowerCurveChart
                        data={curveData.activity}
                        compareData={curveData.comparison}
                        compareLabel={curvePeriod !== 'none' ? COMPARE_LABELS[curvePeriod as ComparePeriod] : undefined}
                        ftp={curveData.ftp}
                        currentLabel="This ride"
                      />
                    </>
                  ) : curveData ? (
                    <div className="h-40 flex items-center justify-center text-ink-5 text-sm">
                      No power stream data for this activity
                    </div>
                  ) : null}
                </div>

                {/* Best Efforts */}
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-ink-4 uppercase tracking-wider">Best Efforts</p>
                  <Link
                    href={`/training?tab=power&s=${bpSeconds}`}
                    className="text-xs text-accent-hi hover:text-accent-hi transition-colors"
                  >
                    All activities →
                  </Link>
                </div>

                <div className="flex items-center gap-3">
                  <select
                    value={bpSeconds}
                    onChange={e => setBpSeconds(Number(e.target.value))}
                    className="bg-raised border border-line-strong rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent"
                  >
                    {INTERVALS.map(iv => (
                      <option key={iv.seconds} value={iv.seconds}>{iv.label}</option>
                    ))}
                  </select>
                  <span className="text-xs text-ink-4">Top 5 non-overlapping best efforts</span>
                </div>

                {bpLoading ? (
                  <div className="space-y-2">
                    {[1,2,3,4,5].map(i => <div key={i} className="h-10 bg-raised rounded-xl animate-pulse" />)}
                  </div>
                ) : bpResults && bpResults.length > 0 ? (
                  <div className="bg-surface rounded-xl border border-line overflow-x-auto scroll-touch">
                    <table className="text-sm w-full whitespace-nowrap">
                      <thead>
                        <tr className="border-b border-line">
                          <th className="text-left px-4 py-3 text-ink-4 font-medium">#</th>
                          <th className="text-right px-4 py-3 text-ink-4 font-medium">Avg Power</th>
                          <th className="text-right px-4 py-3 text-ink-4 font-medium">Max Power</th>
                          <th className="text-right px-4 py-3 text-ink-4 font-medium">Avg HR</th>
                          <th className="text-right px-4 py-3 text-ink-4 font-medium">Max HR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bpResults.map((r, i) => (
                          <tr key={r.rank} className={`border-b border-line/60 last:border-0 ${i === 0 ? 'bg-accent/5' : i % 2 !== 0 ? 'bg-raised/30' : ''}`}>
                            <td className={`px-4 py-3 font-medium ${i === 0 ? 'text-accent-hi' : 'text-ink-4'}`}>#{r.rank}</td>
                            <td className={`px-4 py-3 text-right font-bold tabular-nums ${i === 0 ? 'text-ink' : 'text-ink'}`}>
                              {r.watts} <span className="text-xs font-normal text-ink-4">W</span>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-ink-2">
                              {r.max_watts} <span className="text-xs text-ink-4">W</span>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-ink-2">
                              {r.avg_hr ? <>{r.avg_hr} <span className="text-xs text-ink-4">bpm</span></> : '—'}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-ink-2">
                              {r.max_hr ? <>{r.max_hr} <span className="text-xs text-ink-4">bpm</span></> : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-ink-4 py-4">No power data</p>
                )}
              </div>
            ) : (
              <div className="bg-raised/50 border border-line-strong border-dashed rounded-xl p-8 text-center">
                <p className="text-ink-4 text-sm">No power data for this activity</p>
              </div>
            )}

            {/* ── Aerobic Efficiency section ── */}
            <AerobicEfficiencyChart activityId={id} showCompare={false} />

            {/* ── Time in Zones section ── */}
            <div>
              <p className="text-xs font-semibold text-ink-4 uppercase tracking-wider mb-3">Time in Zones</p>
              <ZoneDistribution activityId={id} />
            </div>
          </div>
        )}

        {/* Tab: Segments */}
        {segmentsEnabled && tab === 'segments' && (
          <div>
            {segLoading ? (
              <div className="space-y-2">
                {[1,2,3].map(i => <div key={i} className="h-16 bg-raised rounded-xl animate-pulse" />)}
              </div>
            ) : segments.length === 0 ? (
              <div className="bg-raised/40 rounded-xl p-6 text-center space-y-2">
                <p className="text-ink-3 text-sm">No starred segments matched this activity.</p>
                <p className="text-ink-4 text-xs">
                  Star segments on Strava, then{' '}
                  <button
                    onClick={async () => {
                      await fetch('/api/segments/starred', { method: 'POST' });
                      setSegFetched(false);
                    }}
                    className="text-accent-hi hover:underline"
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
                      className={`block rounded-xl p-4 border transition-colors hover:border-line-hover/60 ${
                        isPR
                          ? 'bg-yellow-500/10 border-yellow-500/40'
                          : 'bg-raised/60 border-line-strong/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-sm font-semibold text-ink truncate">{seg.name}</span>
                            {isPR && (
                              <span className="text-micro bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-1.5 py-0.5 rounded font-bold flex-shrink-0">🏆 PR</span>
                            )}
                            {isTop3 && !isPR && (
                              <span className="text-micro bg-accent/20 text-accent-hi border border-accent/30 px-1.5 py-0.5 rounded font-bold flex-shrink-0">Top {seg.kom_rank}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 flex-wrap text-xs text-ink-3">
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
                          <p className={`text-lg font-bold tabular-nums ${isPR ? 'text-yellow-300' : 'text-ink'}`}>{timeStr}</p>
                          <div className="flex items-center gap-2 justify-end text-xs text-ink-3">
                            {seg.average_watts && (
                              <span>{Math.round(seg.average_watts)}W</span>
                            )}
                            {seg.average_heartrate && (
                              <span className="text-red-400">♥ {Math.round(seg.average_heartrate)}</span>
                            )}
                          </div>
                          <span className="text-micro text-accent-hi mt-1 block">History →</span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
    </>
  );

  // ── Desktop (lg+): two-column analysis workbench ──
  if (isDesktop) {
    return (
      <div className="h-full overflow-hidden">
        <div className="h-full grid grid-cols-12 gap-6 px-6 py-4">
          {/* Left: header, stats, stream charts */}
          <div className="col-span-7 h-full min-h-0 overflow-y-auto scroll-touch space-y-5 pr-1">
            {backLink}
            <div className="flex gap-4 items-start">{headerInner}</div>
            {coachLink}
            <StreamCharts activityId={id} onHover={setHoverPoint} />
          </div>

          {/* Right: sticky map + tab content */}
          <div className="col-span-5 h-full min-h-0 flex flex-col gap-4">
            {activity.summary_polyline && (
              <div className="flex-shrink-0">
                <ActivityMap
                  polyline={activity.summary_polyline}
                  className="w-full h-64 rounded-xl overflow-hidden bg-raised"
                  hoverPoint={hoverPoint}
                />
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto scroll-touch space-y-5">
              {tabsNav}
              {tabPanels}
            </div>
          </div>
        </div>
        {editModal}
      </div>
    );
  }

  // ── Mobile / tablet: original single-column layout ──
  return (
    <div className="h-full overflow-y-auto scroll-touch">
      <div className="max-w-2xl md:max-w-5xl xl:max-w-7xl mx-auto px-4 py-6 space-y-5">

        {backLink}

        {/* Header + Map */}
        <div className="flex gap-4 items-start">
          {headerInner}

          {/* Desktop map (side-by-side with stats) */}
          {activity.summary_polyline ? (
            <div className="w-[42%] flex-shrink-0 hidden sm:block">
              <ActivityMap
                polyline={activity.summary_polyline}
                className="w-full h-48 rounded-xl overflow-hidden bg-raised"
              />
            </div>
          ) : null}
        </div>

        {/* Get Coach feedback — between top stats and the map */}
        {coachLink}

        {/* Mobile map (full width below the button) */}
        {activity.summary_polyline && (
          <div className="sm:hidden">
            <ActivityMap
              polyline={activity.summary_polyline}
              className="w-full h-48 rounded-xl overflow-hidden bg-raised"
            />
          </div>
        )}

        {tabsNav}
        {tabPanels}

      </div>
      {editModal}
    </div>
  );
}
