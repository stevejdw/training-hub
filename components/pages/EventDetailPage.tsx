'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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

interface Props { eventId: string }

export default function EventDetailPage({ eventId }: Props) {
  const router = useRouter();
  const { profile, setProfile, save, saving, saved } = useProfileEdit();

  const eventIdx = profile?.events.findIndex(e => (e.id ?? '') === eventId) ?? -1;
  const event    = eventIdx >= 0 ? profile!.events[eventIdx] : null;

  // Event detail fields
  const [name,     setName]     = useState('');
  const [date,     setDate]     = useState('');
  const [location, setLocation] = useState('');
  const [goal,     setGoal]     = useState('');

  // Route state
  const [routeInput,   setRouteInput]   = useState('');
  const [route,        setRoute]        = useState<CachedRoute | null>(null);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [routeError,   setRouteError]   = useState<string | null>(null);
  const [climbs,       setClimbs]       = useState<EventClimb[]>([]);
  const [autoDetected, setAutoDetected] = useState(false);

  // UI state
  const [selectedClimbIdx, setSelectedClimbIdx] = useState<number | null>(null);
  const [editingPacing,    setEditingPacing]    = useState(false);
  const [flatWatts,        setFlatWatts]        = useState(DEFAULT_FLAT_WATTS);
  const [descentWatts,     setDescentWatts]     = useState(DEFAULT_DESCENT_WATTS);

  // Weights from profile
  const riderKg = profile?.weight_kg      ?? 75;
  const bikeKg  = profile?.bike_weight_kg ?? 8;

  // Populate from profile once loaded
  useEffect(() => {
    if (!event) return;
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

  // Auto-detect climbs when route first loads
  useEffect(() => {
    if (!route || autoDetected) return;
    if (climbs.length > 0) { setAutoDetected(true); return; }
    const detected = detectClimbs(route.stream_distance_km, route.stream_altitude_m);
    if (detected.length > 0) {
      setClimbs(detected.map((c, i) => ({
        ...c,
        name:         `Climb ${i + 1}`,
        target_watts: Math.round(flatWatts * 0.88),
      })));
    }
    setAutoDetected(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  // ── Derived: chart data ──────────────────────────────────────────────────
  const chartData = useMemo(() =>
    route ? route.stream_distance_km.map((d, i) => ({ km: d, alt: route.stream_altitude_m[i] })) : [],
    [route]
  );

  // ── Derived: pacing segments ─────────────────────────────────────────────
  const segments = useMemo(() => {
    if (!route || climbs.length === 0) return [];
    return buildPacingSegments(
      route.stream_distance_km,
      route.stream_altitude_m,
      route.distance_m / 1000,
      climbs,
      flatWatts,
      descentWatts,
      riderKg,
      bikeKg,
    );
  }, [route, climbs, flatWatts, descentWatts, riderKg, bikeKg]);

  const estMin      = useMemo(() => {
    if (!route) return null;
    return estimateTime({
      stream_distance_km: route.stream_distance_km,
      stream_altitude_m:  route.stream_altitude_m,
      flat_watts:         flatWatts,
      descent_watts:      descentWatts,
      climbs,
      rider_weight_kg:    riderKg,
      bike_weight_kg:     bikeKg,
    });
  }, [route, flatWatts, descentWatts, climbs, riderKg, bikeKg]);

  const np       = useMemo(() => segments.length ? calcNP(segments)       : null, [segments]);
  const avgWatts = useMemo(() => segments.length ? calcAvgWatts(segments) : null, [segments]);
  const calories = useMemo(() =>
    avgWatts && estMin ? calcCalories(avgWatts, estMin) : null,
    [avgWatts, estMin]
  );

  // ── Helpers ──────────────────────────────────────────────────────────────
  async function loadRoute() {
    const raw   = routeInput.trim();
    const match = raw.match(/\d{5,}/);
    if (!match) { setRouteError('Enter a Strava route URL or ID'); return; }
    const id = match[0];
    setLoadingRoute(true);
    setRouteError(null);
    try {
      const res  = await fetch(`/api/strava/route/${id}`);
      const data = await res.json();
      if (data.error) { setRouteError(data.error); return; }
      setRoute(data as CachedRoute);
      setAutoDetected(false);
      setClimbs([]);
    } finally {
      setLoadingRoute(false);
    }
  }

  const buildUpdatedEvent = useCallback((): EventGoal => {
    const strategy: PacingStrategy | null = route
      ? {
          flat_watts:     flatWatts,
          descent_watts:  descentWatts,
          bike_weight_kg: bikeKg,
          climbs,
          est_time_min:   estMin ?? 0,
        }
      : event?.pacing_strategy ?? null;
    return {
      id: eventId,
      name, date, location, goal,
      strava_route_id: route?.id ?? event?.strava_route_id,
      route:           route ?? event?.route ?? null,
      pacing_strategy: strategy,
    };
  }, [eventId, name, date, location, goal, route, flatWatts, descentWatts, bikeKg, climbs, estMin, event]);

  function saveEvent() {
    if (!profile) return;
    const updated = buildUpdatedEvent();
    const events  = profile.events.map(e => (e.id ?? '') === eventId ? updated : e);
    const merged  = { ...profile, events };
    setProfile(merged);
    save(merged);
    router.push('/events');
  }

  /** Save current state to profile (so ClimbDetailPage reads fresh data) then navigate to climb. */
  function viewClimb(idx: number) {
    if (!profile) return;
    // Flush local state into profile context so ClimbDetailPage sees up-to-date route + climbs
    const updated = buildUpdatedEvent();
    const events  = profile.events.map(e => (e.id ?? '') === eventId ? updated : e);
    const merged  = { ...profile, events };
    setProfile(merged);   // synchronous context update — ClimbDetailPage sees this immediately
    save(merged);         // async DB persist
    router.push(`/events/${eventId}/climb/${idx}`);
  }

  function deleteEvent() {
    if (!profile || !confirm('Delete this event?')) return;
    const events = profile.events.filter(e => (e.id ?? '') !== eventId);
    const merged = { ...profile, events };
    setProfile(merged);
    save(merged);
    router.push('/events');
  }

  function updateClimbWatts(i: number, watts: number) {
    setClimbs(prev => prev.map((c, idx) => idx === i ? { ...c, target_watts: watts } : c));
  }

  // ── UI values ────────────────────────────────────────────────────────────
  const totalKm   = route ? Math.round(route.distance_m / 100) / 10 : 0;
  const totalGain = route ? Math.round(route.elevation_gain) : 0;

  const days = date ? daysToGo(date) : null;
  const daysLabel = days === null ? null
    : days === 0  ? 'Today!'
    : days === 1  ? 'Tomorrow'
    : days > 0    ? `${days} days to go`
    : `${Math.abs(days)} days ago`;
  const daysColor = days !== null && days <= 7 && days > 0 ? 'text-yellow-400'
    : days !== null && days <= 0 ? 'text-gray-500'
    : 'text-green-400';

  if (!profile) {
    return (
      <div className="h-full flex flex-col">
        <PageHeader icon={iconFor('events')} title="Event" />
        <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">Loading…</div>
      </div>
    );
  }

  const saveBtn = (
    <button
      onClick={saveEvent}
      disabled={saving}
      className="px-4 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-medium transition-colors"
    >
      {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
    </button>
  );

  return (
    <div className="h-full flex flex-col">
      <PageHeader icon={iconFor('events')} title={name || 'Event'} right={saveBtn} />

      <div className="flex-shrink-0 px-4 md:px-8 py-2 border-b border-gray-800/60 flex items-center justify-between">
        <Link href="/events" className="text-sm text-gray-500 hover:text-orange-400 transition-colors">
          ← Events
        </Link>
        {daysLabel && (
          <span className={`text-xs font-semibold uppercase tracking-wider ${daysColor}`}>{daysLabel}</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scroll-touch">
        <div className="max-w-2xl mx-auto px-4 py-4 md:px-8 md:py-6 space-y-5">

          {/* ── Event details ─────────────────────────────────────── */}
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

          {/* ── Strava course ─────────────────────────────────────── */}
          <section className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Strava Course</h2>
            <div className="flex gap-2">
              <input
                type="text"
                value={routeInput}
                onChange={e => setRouteInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && loadRoute()}
                placeholder="Route URL or ID"
                className={inputCls + ' flex-1'}
              />
              <button
                onClick={loadRoute}
                disabled={loadingRoute}
                className="flex-shrink-0 px-4 py-2 bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {loadingRoute ? '…' : 'Load'}
              </button>
            </div>
            {routeError && <p className="text-red-400 text-xs">{routeError}</p>}
            {route && (
              <div className="flex items-center gap-4 pt-1 flex-wrap">
                <span className="text-sm font-semibold text-white">{route.name}</span>
                <span className="text-xs text-gray-400">{totalKm} km</span>
                <span className="text-xs text-gray-400">{totalGain} m elevation</span>
              </div>
            )}
          </section>

          {/* ── Elevation profile ─────────────────────────────────── */}
          {route && chartData.length > 0 && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Elevation Profile</h2>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="elevGradDetail" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#f97316" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                  <XAxis dataKey="km" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${v}km`} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} width={36} tickFormatter={v => `${v}m`} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const km = payload[0].payload.km as number;
                      const inClimb = climbs.find(c => km >= c.start_km && km <= c.end_km);
                      return (
                        <div className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-xs">
                          <p className="text-gray-400">{km} km{inClimb ? ` · ${inClimb.name}` : ''}</p>
                          <p className="text-white font-semibold">{payload[0].value} m</p>
                        </div>
                      );
                    }}
                  />
                  {/* All climbs — use key that includes selection so Recharts re-renders on change */}
                  {climbs.map((c, i) => {
                    const sel = selectedClimbIdx === i;
                    return (
                      <ReferenceArea
                        key={`climb-${i}-${sel}`}
                        x1={c.start_km} x2={c.end_km}
                        fill={sel ? '#f97316' : '#ef4444'}
                        fillOpacity={sel ? 0.35 : 0.20}
                        stroke={sel ? '#f97316' : '#ef4444'}
                        strokeOpacity={sel ? 1 : 0.5}
                        strokeWidth={sel ? 2 : 1}
                      />
                    );
                  })}
                  <Area type="monotone" dataKey="alt" stroke="#f97316" strokeWidth={2} fill="url(#elevGradDetail)" dot={false} activeDot={{ r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
              {selectedClimbIdx !== null && climbs[selectedClimbIdx] && (
                <p className="text-xs text-orange-400 text-center">
                  ▲ {climbs[selectedClimbIdx].name} highlighted — {climbs[selectedClimbIdx].start_km}–{climbs[selectedClimbIdx].end_km} km
                </p>
              )}
            </section>
          )}

          {/* ── Key Climbs ────────────────────────────────────────── */}
          {route && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Key Climbs {climbs.length > 0 && <span className="text-gray-600 font-normal">({climbs.length})</span>}
              </h2>

              {climbs.length === 0 ? (
                <p className="text-xs text-gray-600 py-1">No significant climbs detected. Ensure the route has elevation data.</p>
              ) : (
                <div className="space-y-2">
                  {climbs.map((c, i) => {
                    const isSelected = selectedClimbIdx === i;
                    return (
                      <button
                        key={i}
                        onClick={() => setSelectedClimbIdx(isSelected ? null : i)}
                        className={`w-full text-left border rounded-xl p-3 transition-all ${
                          isSelected
                            ? 'border-orange-500/60 bg-orange-500/8'
                            : 'border-gray-800 hover:border-gray-700'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                              isSelected ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-400'
                            }`}>
                              {i + 1}
                            </span>
                            <span className="text-sm font-semibold text-white truncate">{c.name}</span>
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); viewClimb(i); }}
                            className="flex-shrink-0 text-xs text-orange-400 hover:text-orange-300 transition-colors"
                          >
                            View →
                          </button>
                        </div>

                        <div className="mt-2 grid grid-cols-4 gap-1 text-center">
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
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* ── Pacing Strategy ───────────────────────────────────── */}
          <section className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Pacing Strategy</h2>
              {route && (
                <button
                  onClick={() => setEditingPacing(e => !e)}
                  className="text-xs text-orange-400 hover:text-orange-300 transition-colors font-medium"
                >
                  {editingPacing ? 'Done' : 'Edit'}
                </button>
              )}
            </div>

            {!route ? (
              <p className="text-xs text-gray-600 italic">Load a Strava course above to build your pacing strategy.</p>
            ) : editingPacing ? (
              /* ── Edit mode ──────────────────────────── */
              <div className="space-y-4">
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Non-Climb Segments</p>
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
                </div>

                {climbs.length > 0 && (
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Climb Targets</p>
                    <div className="space-y-2">
                      {climbs.map((c, i) => (
                        <div key={i} className="flex items-center gap-3 bg-gray-800/50 rounded-lg px-3 py-2">
                          <span className="flex-1 text-sm text-gray-300 truncate">{c.name}</span>
                          <span className="text-xs text-gray-500 flex-shrink-0">{c.distance_km} km · {c.avg_gradient}%</span>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <input
                              type="number"
                              value={c.target_watts}
                              onChange={e => updateClimbWatts(i, Number(e.target.value))}
                              className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white text-right focus:outline-none focus:border-orange-500"
                              step={5} min={50} max={600}
                            />
                            <span className="text-xs text-gray-500">W</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-[10px] text-gray-600">Rider: {riderKg} kg · Bike: {bikeKg} kg · System: {riderKg + bikeKg} kg</p>
              </div>
            ) : (
              /* ── View mode ──────────────────────────── */
              <div className="space-y-4">
                {/* Overall stats */}
                {estMin && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="bg-gray-800/60 rounded-xl p-3 text-center">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Duration</p>
                      <p className="text-xl font-bold text-white tabular-nums">{fmtTime(estMin)}</p>
                    </div>
                    <div className="bg-gray-800/60 rounded-xl p-3 text-center">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Avg Watts</p>
                      <p className="text-xl font-bold text-blue-400">{avgWatts ?? '—'}</p>
                    </div>
                    <div className="bg-gray-800/60 rounded-xl p-3 text-center">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">NP</p>
                      <p className="text-xl font-bold text-orange-400">{np ?? '—'}</p>
                    </div>
                    <div className="bg-gray-800/60 rounded-xl p-3 text-center">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Calories</p>
                      <p className="text-xl font-bold text-green-400">{calories ? `${calories.toLocaleString()}` : '—'}</p>
                    </div>
                  </div>
                )}

                {/* Segment breakdown */}
                {segments.length > 0 ? (
                  <div>
                    <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">Segment Breakdown</p>
                    <div className="space-y-1">
                      {segments.map((seg, i) => (
                        <div
                          key={i}
                          className={`flex items-center gap-2 py-2 px-3 rounded-lg text-xs ${
                            seg.type === 'climb'
                              ? 'bg-orange-500/8 border border-orange-500/20'
                              : seg.type === 'descent'
                              ? 'bg-blue-500/5 border border-blue-500/15'
                              : 'border border-transparent'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <span className={`font-medium ${
                              seg.type === 'climb'   ? 'text-orange-300' :
                              seg.type === 'descent' ? 'text-blue-300'   : 'text-gray-300'
                            }`}>{seg.label}</span>
                            <span className="text-gray-600 ml-2">
                              {seg.start_km}–{seg.end_km} km
                            </span>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0 text-right">
                            <span className="text-gray-500 w-14 text-right">
                              {seg.distance_km} km
                            </span>
                            <span className={`w-16 text-right ${seg.elevation_gain >= 0 ? 'text-orange-400' : 'text-blue-400'}`}>
                              {seg.elevation_gain >= 0 ? '+' : ''}{seg.elevation_gain} m
                            </span>
                            <span className="text-gray-400 w-10 text-right">{seg.target_watts}W</span>
                            <span className="text-white font-medium w-10 text-right tabular-nums">{fmtTime(seg.est_time_min)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : !estMin ? (
                  <p className="text-xs text-gray-600 italic">No segments built yet — load a route and ensure climbs are detected.</p>
                ) : null}

                {/* Simple time if no segments */}
                {estMin && segments.length === 0 && (
                  <div className="bg-gray-800/60 rounded-xl p-4">
                    <span className="text-4xl font-bold text-white tabular-nums">{fmtTime(estMin)}</span>
                    <span className="text-sm text-gray-500 ml-2">estimated</span>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── Danger zone ───────────────────────────────────────── */}
          <div className="flex justify-between items-center pt-2 pb-4">
            <button
              onClick={deleteEvent}
              className="text-xs text-gray-600 hover:text-red-400 transition-colors"
            >
              Delete event
            </button>
            <button
              onClick={saveEvent}
              disabled={saving}
              className="px-6 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              {saving ? 'Saving…' : 'Save event'}
            </button>
          </div>

          <div className="h-20" />
        </div>
      </div>
    </div>
  );
}
