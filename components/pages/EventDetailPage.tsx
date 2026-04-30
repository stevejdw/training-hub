'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceArea,
} from 'recharts';
import type { EventGoal, EventClimb, CachedRoute, PacingStrategy } from '@/lib/profile';
import {
  detectClimbs, estimateTime, buildPacingSegments,
  calcNP, calcAvgWatts, calcCalories, fmtTime,
} from '@/lib/pacing';
import PageHeader from '@/components/PageHeader';
import { iconFor } from '@/components/nav-items';
import { useProfileEdit, inputCls } from '@/lib/use-profile-edit';
import Link from 'next/link';

const DEFAULT_FLAT_WATTS    = 260;
const DEFAULT_DESCENT_WATTS = 120;

function daysToGo(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d     = new Date(dateStr + 'T00:00:00'); d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return '';
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [, m, d] = dateStr.split('-').map(Number);
  return `${d} ${M[m - 1]}`;
}

// ─── Course map SVG ───────────────────────────────────────────────────────────
function CourseMap({ latlng, climbs, distKm }: {
  latlng: [number, number][];
  climbs: EventClimb[];
  distKm: number[];
}) {
  if (!latlng.length) return null;

  const lats = latlng.map(p => p[0]);
  const lngs = latlng.map(p => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

  const cosLat = Math.cos(((maxLat + minLat) / 2) * Math.PI / 180);
  const latSpan = maxLat - minLat || 0.01;
  const lngSpan = (maxLng - minLng) * cosLat || 0.01;

  const W = 400, H = Math.round(W * latSpan / lngSpan);
  const clampedH = Math.min(Math.max(H, 100), 260);
  const pad = 14;

  function toX(lng: number) {
    return pad + ((lng - minLng) * cosLat / lngSpan) * (W - 2 * pad);
  }
  function toY(lat: number) {
    return clampedH - pad - ((lat - minLat) / latSpan) * (clampedH - 2 * pad);
  }

  const routePoints = latlng.map(p => `${toX(p[1]).toFixed(1)},${toY(p[0]).toFixed(1)}`).join(' ');

  // Build climb polylines using the distance array as index guide
  const totalDist = distKm[distKm.length - 1] || 1;
  const climbSegments = climbs.map(c => {
    const pts: string[] = [];
    for (let i = 0; i < distKm.length && i < latlng.length; i++) {
      if (distKm[i] >= c.start_km - 0.2 && distKm[i] <= c.end_km + 0.2) {
        pts.push(`${toX(latlng[i][1]).toFixed(1)},${toY(latlng[i][0]).toFixed(1)}`);
      }
    }
    return pts;
  });

  const start = latlng[0];
  const end   = latlng[latlng.length - 1];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void totalDist;

  return (
    <svg
      viewBox={`0 0 ${W} ${clampedH}`}
      className="w-full rounded-xl"
      style={{ background: '#0f172a' }}
    >
      {/* Route */}
      <polyline
        points={routePoints}
        fill="none"
        stroke="#f97316"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity="0.7"
      />
      {/* Climbs overlay */}
      {climbSegments.map((pts, i) =>
        pts.length > 1 ? (
          <polyline
            key={i}
            points={pts.join(' ')}
            fill="none"
            stroke="#ef4444"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity="0.9"
          />
        ) : null
      )}
      {/* Start marker */}
      <circle cx={toX(start[1])} cy={toY(start[0])} r="5" fill="#22c55e" />
      <circle cx={toX(start[1])} cy={toY(start[0])} r="5" fill="none" stroke="#fff" strokeWidth="1" strokeOpacity="0.5" />
      {/* End marker */}
      <circle cx={toX(end[1])} cy={toY(end[0])} r="5" fill="#ef4444" />
      <circle cx={toX(end[1])} cy={toY(end[0])} r="5" fill="none" stroke="#fff" strokeWidth="1" strokeOpacity="0.5" />
    </svg>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
interface Props { eventId: string }

export default function EventDetailPage({ eventId }: Props) {
  const router = useRouter();
  const { profile, setProfile, save, saving } = useProfileEdit();

  const eventIdx = profile?.events.findIndex(e => (e.id ?? '') === eventId) ?? -1;
  const event    = eventIdx >= 0 ? profile!.events[eventIdx] : null;

  // ── Editable fields ──
  const [name,     setName]     = useState('');
  const [date,     setDate]     = useState('');
  const [location, setLocation] = useState('');
  const [goal,     setGoal]     = useState('');

  // ── Route + climbs ──
  const [routeInput,   setRouteInput]   = useState('');
  const [route,        setRoute]        = useState<CachedRoute | null>(null);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [routeError,   setRouteError]   = useState<string | null>(null);
  const [climbs,       setClimbs]       = useState<EventClimb[]>([]);
  const [autoDetected, setAutoDetected] = useState(false);

  // ── UI state ──
  const [editing,       setEditing]       = useState(false);
  const [selectedClimb, setSelectedClimb] = useState<number | null>(null);
  const [climbsOpen,    setClimbsOpen]    = useState(false);
  const [pacingOpen,    setPacingOpen]    = useState(false);
  const [editingPacing, setEditingPacing] = useState(false);
  const [flatWatts,     setFlatWatts]     = useState(DEFAULT_FLAT_WATTS);
  const [descentWatts,  setDescentWatts]  = useState(DEFAULT_DESCENT_WATTS);

  const riderKg = profile?.weight_kg      ?? 75;
  const bikeKg  = profile?.bike_weight_kg ?? 8;

  // Track whether we have unsaved edits in edit mode
  const savedEventRef = useRef(event);

  // ── Populate from profile once loaded ──
  useEffect(() => {
    if (!event) return;
    savedEventRef.current = event;
    setName(event.name ?? '');
    setDate(event.date ?? '');
    setLocation(event.location ?? '');
    setGoal(event.goal ?? '');
    setRouteInput(event.strava_route_id ?? '');
    if (event.route) setRoute(event.route);
    if (event.pacing_strategy) {
      setFlatWatts(event.pacing_strategy.flat_watts ?? DEFAULT_FLAT_WATTS);
      setDescentWatts(event.pacing_strategy.descent_watts ?? DEFAULT_DESCENT_WATTS);
      setClimbs(event.pacing_strategy.climbs ?? []);
      setAutoDetected(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventIdx >= 0]);

  // ── Auto-detect climbs ──
  useEffect(() => {
    if (!route || autoDetected) return;
    if (climbs.length > 0) { setAutoDetected(true); return; }
    const detected = detectClimbs(route.stream_distance_km, route.stream_altitude_m);
    const newClimbs = detected.map((c, i) => ({
      ...c, name: `Climb ${i + 1}`, target_watts: Math.round(flatWatts * 0.88),
    }));
    setClimbs(newClimbs);
    setAutoDetected(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  // ── Derived ──
  const chartData = useMemo(() =>
    route ? route.stream_distance_km.map((d, i) => ({ km: d, alt: route.stream_altitude_m[i] })) : [],
    [route]
  );

  const segments = useMemo(() => {
    if (!route || climbs.length === 0) return [];
    return buildPacingSegments(
      route.stream_distance_km, route.stream_altitude_m,
      route.distance_m / 1000, climbs,
      flatWatts, descentWatts, riderKg, bikeKg,
    );
  }, [route, climbs, flatWatts, descentWatts, riderKg, bikeKg]);

  const estMin = useMemo(() => {
    if (!route) return null;
    return estimateTime({
      stream_distance_km: route.stream_distance_km,
      stream_altitude_m:  route.stream_altitude_m,
      flat_watts: flatWatts, descent_watts: descentWatts,
      climbs, rider_weight_kg: riderKg, bike_weight_kg: bikeKg,
    });
  }, [route, flatWatts, descentWatts, climbs, riderKg, bikeKg]);

  const np       = useMemo(() => segments.length ? calcNP(segments)       : null, [segments]);
  const avgWatts = useMemo(() => segments.length ? calcAvgWatts(segments) : null, [segments]);
  const calories = useMemo(() =>
    avgWatts && estMin ? calcCalories(avgWatts, estMin) : null,
    [avgWatts, estMin]
  );

  const totalKm   = route ? Math.round(route.distance_m / 100) / 10 : 0;
  const totalGain = route ? Math.round(route.elevation_gain) : 0;
  const totalClimbAscent = climbs.reduce((s, c) => s + c.elevation_gain, 0);

  // ── Helpers ──
  async function loadRoute() {
    const match = routeInput.trim().match(/\d{5,}/);
    if (!match) { setRouteError('Enter a Strava route URL or ID'); return; }
    setLoadingRoute(true); setRouteError(null);
    try {
      const res  = await fetch(`/api/strava/route/${match[0]}`);
      const data = await res.json();
      if (data.error) { setRouteError(data.error); return; }
      setRoute(data as CachedRoute);
      setAutoDetected(false); setClimbs([]);
    } finally { setLoadingRoute(false); }
  }

  const buildUpdatedEvent = useCallback((): EventGoal => {
    const strategy: PacingStrategy | null = route
      ? { flat_watts: flatWatts, descent_watts: descentWatts, bike_weight_kg: bikeKg, climbs, est_time_min: estMin ?? 0 }
      : event?.pacing_strategy ?? null;
    return {
      id: eventId, name, date, location, goal,
      strava_route_id: route?.id ?? event?.strava_route_id,
      route: route ?? event?.route ?? null,
      pacing_strategy: strategy,
    };
  }, [eventId, name, date, location, goal, route, flatWatts, descentWatts, bikeKg, climbs, estMin, event]);

  function persistEvent(andNavigate = false) {
    if (!profile) return;
    const updated = buildUpdatedEvent();
    const events  = profile.events.map(e => (e.id ?? '') === eventId ? updated : e);
    const merged  = { ...profile, events };
    setProfile(merged);
    save(merged);
    if (andNavigate) router.push('/events');
  }

  function cancelEdit() {
    const e = savedEventRef.current;
    setName(e?.name ?? '');
    setDate(e?.date ?? '');
    setLocation(e?.location ?? '');
    setGoal(e?.goal ?? '');
    setRoute(e?.route ?? null);
    setRouteInput(e?.strava_route_id ?? '');
    setEditing(false);
  }

  function saveEdit() {
    persistEvent(false);
    setEditing(false);
  }

  function deleteEvent() {
    if (!profile || !confirm('Delete this event?')) return;
    const events = profile.events.filter(e => (e.id ?? '') !== eventId);
    const merged = { ...profile, events };
    setProfile(merged); save(merged);
    router.push('/events');
  }

  function viewClimb(idx: number) {
    if (!profile) return;
    const updated = buildUpdatedEvent();
    const events  = profile.events.map(e => (e.id ?? '') === eventId ? updated : e);
    const merged  = { ...profile, events };
    setProfile(merged); save(merged);
    router.push(`/events/${eventId}/climb/${idx}`);
  }

  function updateClimbWatts(i: number, watts: number) {
    setClimbs(prev => prev.map((c, idx) => idx === i ? { ...c, target_watts: watts } : c));
  }

  // ── Days/color ──
  const days = date ? daysToGo(date) : null;
  const daysLabel = days === null ? null
    : days === 0 ? 'Today!'
    : days === 1 ? 'Tomorrow'
    : days > 0   ? `${days} days to go`
    : `${Math.abs(days)} days ago`;
  const daysColor = days !== null && days <= 7 && days > 0 ? 'text-yellow-400'
    : days !== null && days <= 0 ? 'text-gray-500' : 'text-green-400';

  if (!profile) {
    return (
      <div className="h-full flex flex-col">
        <PageHeader icon={iconFor('events')} title="Event" />
        <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">Loading…</div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  EDIT MODE
  // ══════════════════════════════════════════════════════════════════════════
  if (editing) {
    const editActions = (
      <div className="flex items-center gap-2">
        <button onClick={cancelEdit} className="px-3 py-1.5 text-sm text-gray-400 hover:text-white transition-colors">
          Cancel
        </button>
        <button
          onClick={saveEdit}
          disabled={saving}
          className="px-4 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    );

    return (
      <div className="h-full flex flex-col">
        <PageHeader icon={iconFor('events')} title="Edit Event" right={editActions} />
        <div className="flex-shrink-0 px-4 md:px-8 py-2 border-b border-gray-800/60">
          <button onClick={cancelEdit} className="text-sm text-gray-500 hover:text-orange-400 transition-colors">← Back</button>
        </div>
        <div className="flex-1 overflow-y-auto scroll-touch">
          <div className="max-w-2xl mx-auto px-4 py-4 md:px-8 md:py-6 space-y-5">

            <section className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Event Details</h2>
              <div>
                <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="e.g. Peaks Challenge" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Date</label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Location</label>
                  <input type="text" value={location} onChange={e => setLocation(e.target.value)} className={inputCls} placeholder="e.g. Falls Creek, VIC" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Goal</label>
                <input type="text" value={goal} onChange={e => setGoal(e.target.value)} className={inputCls} placeholder="e.g. Sub 8:30, finish strong, top 10" />
              </div>
            </section>

            <section className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Strava Course</h2>
              {route ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{route.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{totalKm} km · {totalGain} m elevation</p>
                  </div>
                  <button
                    onClick={() => { setRoute(null); setClimbs([]); setAutoDetected(false); setRouteInput(''); }}
                    className="flex-shrink-0 text-xs text-gray-500 hover:text-red-400 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <input
                      type="text" value={routeInput}
                      onChange={e => setRouteInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && loadRoute()}
                      placeholder="Strava route URL or ID"
                      className={inputCls + ' flex-1'}
                    />
                    <button onClick={loadRoute} disabled={loadingRoute}
                      className="flex-shrink-0 px-4 py-2 bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                      {loadingRoute ? '…' : 'Load'}
                    </button>
                  </div>
                  {routeError && <p className="text-red-400 text-xs">{routeError}</p>}
                </>
              )}
            </section>

            <div className="flex justify-between items-center pt-2 pb-4">
              <button onClick={deleteEvent} className="text-xs text-gray-600 hover:text-red-400 transition-colors">
                Delete event
              </button>
              <button onClick={saveEdit} disabled={saving}
                className="px-6 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                {saving ? 'Saving…' : 'Save event'}
              </button>
            </div>
            <div className="h-20" />
          </div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  VIEW MODE
  // ══════════════════════════════════════════════════════════════════════════
  const editBtn = (
    <button
      onClick={() => setEditing(true)}
      className="px-3 py-1.5 text-sm text-gray-400 hover:text-orange-400 border border-gray-700 hover:border-orange-500/50 rounded-lg transition-colors"
    >
      Edit
    </button>
  );

  return (
    <div className="h-full flex flex-col">
      <PageHeader icon={iconFor('events')} title={name || 'Event'} right={editBtn} />

      <div className="flex-shrink-0 px-4 md:px-8 py-2 border-b border-gray-800/60 flex items-center justify-between">
        <Link href="/events" className="text-sm text-gray-500 hover:text-orange-400 transition-colors">← Events</Link>
        {daysLabel && <span className={`text-xs font-semibold uppercase tracking-wider ${daysColor}`}>{daysLabel}</span>}
      </div>

      <div className="flex-1 overflow-y-auto scroll-touch">
        <div className="max-w-2xl mx-auto px-4 py-4 md:px-8 md:py-6 space-y-4">

          {/* ── Event summary ─────────────────────────────────── */}
          <section className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-2">
            {/* Name + goal */}
            <h2 className="text-xl font-bold text-white leading-tight">{name || 'Unnamed Event'}</h2>
            {goal && <p className="text-sm text-orange-300">{goal}</p>}

            {/* Date + location */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {date && (
                <span className="flex items-center gap-1.5 text-sm text-gray-400">
                  <svg className="w-3.5 h-3.5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round"/>
                  </svg>
                  {fmtDate(date)}
                </span>
              )}
              {location && (
                <span className="flex items-center gap-1.5 text-sm text-gray-400">
                  <svg className="w-3.5 h-3.5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  {location}
                </span>
              )}
              {route && (
                <span className="flex items-center gap-1.5 text-sm text-gray-400">
                  <svg className="w-3.5 h-3.5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 13l4.553 2.276A1 1 0 0021 21.382V10.618a1 1 0 00-.553-.894L15 7m0 13V7m0 0L9 4" />
                  </svg>
                  {totalKm} km · {totalGain} m
                </span>
              )}
            </div>

            {!route && (
              <p className="text-xs text-gray-600 italic pt-1">No Strava course — tap Edit to add one.</p>
            )}
          </section>

          {/* ── Course map ────────────────────────────────────── */}
          {route?.stream_latlng && route.stream_latlng.length > 1 && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              <CourseMap
                latlng={route.stream_latlng}
                climbs={climbs}
                distKm={route.stream_distance_km}
              />
              <p className="px-3 pb-2 pt-1 text-[10px] text-gray-600">
                <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1" />Start
                <span className="inline-block w-2 h-2 rounded-full bg-red-500 ml-3 mr-1" />Finish
                <span className="inline-block w-2 h-2 rounded-full bg-red-500 ml-3 mr-1 opacity-60" />Climbs
              </p>
            </section>
          )}

          {/* ── Elevation profile ─────────────────────────────── */}
          {route && chartData.length > 0 && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-2">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Elevation Profile</h2>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#f97316" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                  <XAxis dataKey="km" type="number" domain={['dataMin','dataMax']} tick={{ fill:'#6b7280', fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={v=>`${v}km`} interval="preserveStartEnd" />
                  <YAxis tick={{ fill:'#6b7280', fontSize:10 }} axisLine={false} tickLine={false} width={36} tickFormatter={v=>`${v}m`} />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const km = payload[0].payload.km as number;
                    const inC = climbs.find(c => km >= c.start_km && km <= c.end_km);
                    return (
                      <div className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-xs">
                        <p className="text-gray-400">{km} km{inC ? ` · ${inC.name}` : ''}</p>
                        <p className="text-white font-semibold">{payload[0].value} m</p>
                      </div>
                    );
                  }} />
                  {climbs.map((c, i) => {
                    const sel    = selectedClimb === i;
                    const anySel = selectedClimb !== null;
                    return (
                      <ReferenceArea key={`c${i}-${sel}`}
                        x1={c.start_km} x2={c.end_km}
                        fill={sel ? '#f97316' : '#ef4444'}
                        fillOpacity={sel ? 0.35 : anySel ? 0 : 0.12}
                        stroke={sel ? '#f97316' : '#ef4444'}
                        strokeOpacity={sel ? 1 : anySel ? 0 : 0.3}
                        strokeWidth={sel ? 2 : 1}
                      />
                    );
                  })}
                  <Area type="monotone" dataKey="alt" stroke="#f97316" strokeWidth={2} fill="url(#elevGrad)" dot={false} activeDot={{ r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
              {selectedClimb !== null && climbs[selectedClimb] && (
                <p className="text-xs text-orange-400 text-center">
                  ▲ {climbs[selectedClimb].name} — {climbs[selectedClimb].start_km}–{climbs[selectedClimb].end_km} km
                </p>
              )}
            </section>
          )}

          {/* ── Key Climbs ────────────────────────────────────── */}
          {route && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              {/* Header — always visible, tap to expand */}
              <button
                onClick={() => setClimbsOpen(o => !o)}
                className="w-full flex items-center justify-between p-4 hover:bg-gray-800/40 transition-colors"
              >
                <div className="text-left">
                  <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Key Climbs {climbs.length > 0 && <span className="text-gray-600">({climbs.length})</span>}
                  </h2>
                  {climbs.length > 0 ? (
                    <p className="text-sm text-gray-300 mt-0.5">
                      {climbs.length} climb{climbs.length !== 1 ? 's' : ''} · {totalClimbAscent.toLocaleString()} m total ascent
                    </p>
                  ) : (
                    <p className="text-sm text-gray-600 mt-0.5">No climbs detected</p>
                  )}
                </div>
                <svg className={`w-4 h-4 text-gray-500 flex-shrink-0 transition-transform ${climbsOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Expanded climb list */}
              {climbsOpen && climbs.length > 0 && (
                <div className="border-t border-gray-800 divide-y divide-gray-800/60">
                  {climbs.map((c, i) => {
                    const isSelected = selectedClimb === i;
                    return (
                      <div key={i} className={`p-3 transition-colors ${isSelected ? 'bg-orange-500/8' : ''}`}>
                        <div className="flex items-center justify-between gap-2">
                          <button
                            onClick={() => setSelectedClimb(isSelected ? null : i)}
                            className="flex items-center gap-2 min-w-0"
                          >
                            <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${isSelected ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-400'}`}>
                              {i + 1}
                            </span>
                            <span className="text-sm font-semibold text-white truncate">{c.name}</span>
                          </button>
                          <button
                            onClick={() => viewClimb(i)}
                            className="flex-shrink-0 text-xs text-orange-400 hover:text-orange-300 transition-colors"
                          >
                            View →
                          </button>
                        </div>
                        <div className="mt-2 grid grid-cols-4 gap-1 text-center pl-7">
                          <div>
                            <p className="text-[9px] text-gray-600 uppercase tracking-wider">From start</p>
                            <p className="text-xs font-medium text-gray-300">{c.start_km} km</p>
                          </div>
                          <div>
                            <p className="text-[9px] text-gray-600 uppercase tracking-wider">Length</p>
                            <p className="text-xs font-medium text-gray-300">{c.distance_km} km</p>
                          </div>
                          <div>
                            <p className="text-[9px] text-gray-600 uppercase tracking-wider">Ascent</p>
                            <p className="text-xs font-medium text-orange-400">{c.elevation_gain} m</p>
                          </div>
                          <div>
                            <p className="text-[9px] text-gray-600 uppercase tracking-wider">Gradient</p>
                            <p className="text-xs font-medium text-gray-300">{c.avg_gradient}%</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* ── Pacing Strategy ───────────────────────────────── */}
          {route && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between p-4">
                <button
                  onClick={() => { setPacingOpen(o => !o); }}
                  className="flex-1 flex items-center justify-between text-left hover:opacity-80 transition-opacity"
                >
                  <div>
                    <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Pacing Strategy</h2>
                    {estMin ? (
                      <p className="text-sm text-gray-300 mt-0.5">
                        {fmtTime(estMin)} est
                        {avgWatts ? ` · ${avgWatts}W avg` : ''}
                        {np       ? ` · ${np} NP`         : ''}
                        {calories ? ` · ${calories.toLocaleString()} kcal` : ''}
                      </p>
                    ) : (
                      <p className="text-sm text-gray-600 mt-0.5">No pacing data yet</p>
                    )}
                  </div>
                  <svg className={`w-4 h-4 text-gray-500 flex-shrink-0 transition-transform ml-2 ${pacingOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {pacingOpen && (
                  <button onClick={() => setEditingPacing(e => !e)} className="ml-3 text-xs text-orange-400 hover:text-orange-300 transition-colors font-medium flex-shrink-0">
                    {editingPacing ? 'Done' : 'Edit'}
                  </button>
                )}
              </div>

              {/* Expanded pacing */}
              {pacingOpen && (
                <div className="border-t border-gray-800 p-4 space-y-4">
                  {/* Overall stats */}
                  {estMin && (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {[
                        { label: 'Duration',   value: fmtTime(estMin),                   color: 'text-white' },
                        { label: 'Avg Watts',  value: avgWatts ? String(avgWatts) : '—', color: 'text-blue-400' },
                        { label: 'NP',         value: np       ? String(np)       : '—', color: 'text-orange-400' },
                        { label: 'Calories',   value: calories ? calories.toLocaleString() : '—', color: 'text-green-400' },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="bg-gray-800/60 rounded-xl p-3 text-center">
                          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</p>
                          <p className={`text-xl font-bold tabular-nums ${color}`}>{value}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Edit mode */}
                  {editingPacing && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] text-gray-600 mb-1 block">Flat / Rolling (W)</label>
                          <input type="number" value={flatWatts} onChange={e => setFlatWatts(Number(e.target.value))} className={inputCls} step={5} min={50} max={600} />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-600 mb-1 block">Descent (W)</label>
                          <input type="number" value={descentWatts} onChange={e => setDescentWatts(Number(e.target.value))} className={inputCls} step={5} min={0} max={400} />
                        </div>
                      </div>
                      {climbs.length > 0 && (
                        <div className="space-y-2">
                          {climbs.map((c, i) => (
                            <div key={i} className="flex items-center gap-3 bg-gray-800/50 rounded-lg px-3 py-2">
                              <span className="flex-1 text-sm text-gray-300 truncate">{c.name}</span>
                              <span className="text-xs text-gray-500 flex-shrink-0">{c.distance_km} km · {c.avg_gradient}%</span>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <input type="number" value={c.target_watts} onChange={e => updateClimbWatts(i, Number(e.target.value))}
                                  className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white text-right focus:outline-none focus:border-orange-500" step={5} min={50} max={600} />
                                <span className="text-xs text-gray-500">W</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="text-[10px] text-gray-600">Rider: {riderKg} kg · Bike: {bikeKg} kg · System: {riderKg + bikeKg} kg</p>
                    </div>
                  )}

                  {/* Segment breakdown */}
                  {segments.length > 0 && (
                    <div>
                      <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">Segment Breakdown</p>
                      <div className="space-y-1">
                        {segments.map((seg, i) => (
                          <div key={i} className={`flex items-center gap-2 py-2 px-3 rounded-lg text-xs ${
                            seg.type === 'climb'   ? 'bg-orange-500/8 border border-orange-500/20' :
                            seg.type === 'descent' ? 'bg-blue-500/5 border border-blue-500/15'     : 'border border-transparent'
                          }`}>
                            <span className={`flex-1 font-medium ${seg.type==='climb' ? 'text-orange-300' : seg.type==='descent' ? 'text-blue-300' : 'text-gray-300'}`}>
                              {seg.label}
                            </span>
                            <span className="text-gray-500 w-14 text-right">{seg.distance_km} km</span>
                            <span className={`w-16 text-right ${seg.elevation_gain >= 0 ? 'text-orange-400' : 'text-blue-400'}`}>
                              {seg.elevation_gain >= 0 ? '+' : ''}{seg.elevation_gain} m
                            </span>
                            <span className="text-gray-400 w-10 text-right">{seg.target_watts}W</span>
                            <span className="text-white font-medium w-10 text-right tabular-nums">{fmtTime(seg.est_time_min)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      onClick={() => persistEvent(false)}
                      disabled={saving}
                      className="px-4 py-2 rounded-lg bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 text-sm transition-colors"
                    >
                      {saving ? 'Saving…' : 'Save pacing'}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          <div className="h-20" />
        </div>
      </div>
    </div>
  );
}
