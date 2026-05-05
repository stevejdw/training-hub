'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { EventGoal, EventClimb, CachedRoute, PacingStrategy } from '@/lib/profile';
import type { CompareResponse } from '@/app/api/events/[id]/compare/[activityId]/route';
import {
  buildPacingSegments, calcNP, calcAvgWatts, calcCalories,
  fmtTime, speedForPower, wattsForSegmentSpeed, PacingSegment,
  rhoAtAltitude, PhysicsParams,
} from '@/lib/pacing';
import PageHeader from '@/components/PageHeader';
import { iconFor } from '@/components/nav-items';
import { useProfileEdit } from '@/lib/use-profile-edit';

interface MatchingActivity {
  id:                   number;
  name:                 string;
  start_date:           string;
  distance_m:           number;
  total_elevation_gain: number;
  moving_time:          number;
  average_watts:        number | null;
  normalized_power:     number | null;
}

function fmtMovingTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' });
}

const DEFAULT_FLAT_WATTS    = 260;
const DEFAULT_DESCENT_WATTS = 120;
const DEFAULT_ACCESSORIES   = 2.0;
const DEFAULT_CDA           = 0.35;

const CDA_PRESETS = [
  { label: 'TT tuck', value: 0.25 },
  { label: 'Drops',   value: 0.32 },
  { label: 'Hoods',   value: 0.35 },
  { label: 'Upright', value: 0.42 },
];

function segKey(seg: PacingSegment): string {
  return seg.type === 'climb' ? `climb-${seg.climb_idx}` : `${seg.type}-${seg.start_km}`;
}

function isRolling(seg: PacingSegment) {
  return seg.type === 'flat' && Math.abs(seg.avg_gradient) >= 1;
}

function segColors(seg: PacingSegment) {
  if (seg.type === 'climb')   return { rowBg: 'bg-orange-500/8',  label: 'text-orange-300', dot: 'bg-orange-500/70',  name: 'Climbing'    };
  if (seg.type === 'descent') return { rowBg: 'bg-blue-500/8',    label: 'text-blue-300',   dot: 'bg-blue-500/70',    name: 'Descending'  };
  if (isRolling(seg))         return { rowBg: 'bg-yellow-500/5',  label: 'text-yellow-300', dot: 'bg-yellow-500/70',  name: 'Rolling'     };
  return                             { rowBg: '',                  label: 'text-green-300',  dot: 'bg-green-500/70',   name: 'Flat'        };
}

const COLS = 'grid-cols-[minmax(100px,1fr)_46px_50px_68px_68px_50px]';

interface Props { eventId: string }

export default function EventPacingPage({ eventId }: Props) {
  const { profile, setProfile, save, saving } = useProfileEdit();

  const eventIdx = profile?.events.findIndex(e => (e.id ?? '') === eventId) ?? -1;
  const event    = eventIdx >= 0 ? profile!.events[eventIdx] : null;

  // ── Core pacing state ──
  const [route,           setRoute]           = useState<CachedRoute | null>(null);
  const [climbs,          setClimbs]          = useState<EventClimb[]>([]);
  const [flatWatts,       setFlatWatts]       = useState(DEFAULT_FLAT_WATTS);
  const [descentWatts,    setDescentWatts]    = useState(DEFAULT_DESCENT_WATTS);
  const [descentSpeedKmh, setDescentSpeedKmh] = useState<number | undefined>(undefined);
  const [flatSpeedKmh,    setFlatSpeedKmh]    = useState<number | undefined>(undefined);

  // ── Physics / rider setup state ──
  const [accessoriesKg, setAccessoriesKg] = useState(DEFAULT_ACCESSORIES);
  const [cda,           setCda]           = useState(DEFAULT_CDA);

  // ── Edit modes ──
  const [editingPacing, setEditingPacing] = useState(false);

  // ── Past rides / comparison state ──
  const [showPastRides,     setShowPastRides]     = useState(false);
  const [matchingActivities, setMatchingActivities] = useState<MatchingActivity[] | null>(null);
  const [linkedIds,          setLinkedIds]          = useState<number[]>([]);
  const [loadingRides,       setLoadingRides]       = useState(false);
  const [compareActivityId,  setCompareActivityId]  = useState<number | null>(null);
  const [compareData,        setCompareData]        = useState<CompareResponse | null>(null);
  const [loadingCompare,     setLoadingCompare]     = useState(false);

  // ── Inline segment edit state ──
  const [segWattsEdit, setSegWattsEdit] = useState<Record<string, number>>({});
  const [segSpeedEdit, setSegSpeedEdit] = useState<Record<string, number>>({});
  const [speedDrafts,  setSpeedDrafts]  = useState<Record<string, string>>({});
  const [savedSpeeds,  setSavedSpeeds]  = useState<Record<string, number>>({});

  const riderKg  = profile?.weight_kg      ?? 75;
  const bikeKg   = profile?.bike_weight_kg ?? 8;
  const totalKg  = riderKg + bikeKg + accessoriesKg;
  const eventName = event?.name ?? '';

  // Physics params: altitude-corrected RHO computed from route average altitude
  const physicsParams = useMemo((): PhysicsParams => {
    const rho = route && route.stream_altitude_m.length > 0
      ? rhoAtAltitude(route.stream_altitude_m.reduce((a, b) => a + b, 0) / route.stream_altitude_m.length)
      : undefined;
    return { cda, rho };
  }, [cda, route]);

  // ── Load from profile ──
  useEffect(() => {
    if (!event) return;
    if (event.route) setRoute(event.route);
    if (event.pacing_strategy) {
      setFlatWatts(event.pacing_strategy.flat_watts ?? DEFAULT_FLAT_WATTS);
      setDescentWatts(event.pacing_strategy.descent_watts ?? DEFAULT_DESCENT_WATTS);
      setClimbs(event.pacing_strategy.climbs ?? []);
      setDescentSpeedKmh(event.pacing_strategy.descent_speed_kmh ?? undefined);
      setFlatSpeedKmh(event.pacing_strategy.flat_speed_kmh ?? undefined);
      setAccessoriesKg(event.pacing_strategy.accessories_kg ?? DEFAULT_ACCESSORIES);
      setCda(event.pacing_strategy.cda ?? DEFAULT_CDA);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventIdx >= 0]);

  // ── Derived segments ──
  const baseSegments = useMemo(() => {
    if (!route || climbs.length === 0) return [];
    return buildPacingSegments(
      route.stream_distance_km, route.stream_altitude_m,
      route.distance_m / 1000, climbs,
      flatWatts, descentWatts, riderKg, bikeKg,
      descentSpeedKmh, flatSpeedKmh,
      accessoriesKg, physicsParams,
      route.stream_latlng,
    );
  }, [route, climbs, flatWatts, descentWatts, riderKg, bikeKg, descentSpeedKmh, flatSpeedKmh, accessoriesKg, physicsParams]);

  // Apply per-segment overrides.
  const segments = useMemo(() => {
    if (!editingPacing) {
      if (Object.keys(savedSpeeds).length === 0) return baseSegments;
      return baseSegments.map(seg => {
        const k = segKey(seg);
        const saved = savedSpeeds[k];
        if (saved === undefined) return seg;
        const timeMin = (seg.distance_km / saved) * 60;
        return { ...seg, avg_speed_kmh: saved, est_time_min: timeMin };
      });
    }
    const hasAny = Object.keys(segWattsEdit).length > 0 || Object.keys(segSpeedEdit).length > 0;
    if (!hasAny) return baseSegments;
    return baseSegments.map(seg => {
      const k         = segKey(seg);
      const speedOver = segSpeedEdit[k];
      const wattsOver = segWattsEdit[k];
      if (speedOver === undefined && wattsOver === undefined) return seg;

      if (speedOver !== undefined) {
        const timeMin = (seg.distance_km / speedOver) * 60;
        return { ...seg, target_watts: wattsOver ?? seg.target_watts, avg_speed_kmh: speedOver, est_time_min: timeMin };
      }

      const speedMs  = speedForPower(wattsOver!, seg.avg_gradient / 100, totalKg, physicsParams);
      const speedKmh = Math.round(speedMs * 36) / 10;
      const timeMin  = speedMs > 0 ? (seg.distance_km * 1000 / speedMs) / 60 : seg.est_time_min;
      return { ...seg, target_watts: wattsOver!, avg_speed_kmh: speedKmh, est_time_min: timeMin };
    });
  }, [baseSegments, editingPacing, segWattsEdit, segSpeedEdit, savedSpeeds, totalKg, physicsParams]);

  const estMin    = useMemo(() => segments.reduce((t, s) => t + s.est_time_min, 0), [segments]);
  const np        = useMemo(() => segments.length ? calcNP(segments)       : null, [segments]);
  const avgWatts  = useMemo(() => segments.length ? calcAvgWatts(segments) : null, [segments]);
  const calories  = useMemo(() => avgWatts && estMin ? calcCalories(avgWatts, estMin) : null, [avgWatts, estMin]);

  const climbMin   = useMemo(() => segments.filter(s => s.type === 'climb').reduce((t, s) => t + s.est_time_min, 0), [segments]);
  const descentMin = useMemo(() => segments.filter(s => s.type === 'descent').reduce((t, s) => t + s.est_time_min, 0), [segments]);
  const rollingMin = useMemo(() => segments.filter(s => isRolling(s)).reduce((t, s) => t + s.est_time_min, 0), [segments]);
  const flatMin    = useMemo(() => segments.filter(s => s.type === 'flat' && !isRolling(s)).reduce((t, s) => t + s.est_time_min, 0), [segments]);

  const totalKm      = route ? Math.round(route.distance_m / 100) / 10 : 0;
  const totalAscentM = segments.reduce((t, s) => t + s.ascent_m, 0);
  const totalDescM   = segments.reduce((t, s) => t + Math.max(0, -s.elevation_gain), 0);
  const avgSpeedKmh  = estMin > 0 && totalKm > 0
    ? Math.round((totalKm / (estMin / 60)) * 10) / 10 : null;

  // Altitude note for display
  const avgRouteAlt = route && route.stream_altitude_m.length > 0
    ? Math.round(route.stream_altitude_m.reduce((a, b) => a + b, 0) / route.stream_altitude_m.length)
    : null;

  // ── Segment edit helpers ──
  function getEditWatts(seg: PacingSegment): number {
    const k = segKey(seg);
    if (editingPacing && k in segWattsEdit) return segWattsEdit[k];
    return seg.target_watts;
  }

  function handleWattsChange(seg: PacingSegment, w: number) {
    const k = segKey(seg);
    setSegWattsEdit(prev => ({ ...prev, [k]: w }));
    setSegSpeedEdit(prev => { const n = { ...prev }; delete n[k]; return n; });
    setSpeedDrafts(prev => { const n = { ...prev }; delete n[k]; return n; });
  }

  function getDisplaySpeed(seg: PacingSegment): string {
    const k = segKey(seg);
    if (k in speedDrafts) return speedDrafts[k];
    return String(seg.avg_speed_kmh);
  }

  function setSpeedDraft(seg: PacingSegment, val: string) {
    setSpeedDrafts(prev => ({ ...prev, [segKey(seg)]: val }));
  }

  function handleSpeedBlur(seg: PacingSegment, draftValue: string) {
    const k = segKey(seg);
    const s = parseFloat(draftValue);
    if (!isNaN(s) && s > 0) {
      setSegSpeedEdit(prev => ({ ...prev, [k]: s }));
      if (route) {
        const w = wattsForSegmentSpeed(
          route.stream_distance_km, route.stream_altitude_m,
          seg.start_km, seg.end_km, s, riderKg, bikeKg, physicsParams,
        );
        if (w > 0) setSegWattsEdit(prev => ({ ...prev, [k]: w }));
      }
    }
    setSpeedDrafts(prev => { const n = { ...prev }; delete n[k]; return n; });
  }

  // ── Past rides helpers ──
  const loadMatchingActivities = useCallback(async () => {
    if (matchingActivities !== null) return; // already loaded
    setLoadingRides(true);
    try {
      const res = await fetch(`/api/events/${eventId}/matching-activities`);
      const data = await res.json() as { activities: MatchingActivity[]; linked_ids: number[] };
      setMatchingActivities(data.activities);
      setLinkedIds(data.linked_ids);
    } finally {
      setLoadingRides(false);
    }
  }, [eventId, matchingActivities]);

  async function toggleLink(activityId: number) {
    const newIds = linkedIds.includes(activityId)
      ? linkedIds.filter(id => id !== activityId)
      : [...linkedIds, activityId];
    setLinkedIds(newIds);
    await fetch(`/api/events/${eventId}/matching-activities`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linked_activity_ids: newIds }),
    });
  }

  async function loadComparison(activityId: number) {
    if (compareActivityId === activityId) {
      setCompareActivityId(null);
      setCompareData(null);
      return;
    }
    setCompareActivityId(activityId);
    setCompareData(null);
    setLoadingCompare(true);
    try {
      const res = await fetch(`/api/events/${eventId}/compare/${activityId}`);
      const data = await res.json() as CompareResponse;
      setCompareData(data);
    } finally {
      setLoadingCompare(false);
    }
  }

  function startPacingEdit() {
    setSegWattsEdit({});
    setSegSpeedEdit({});
    setSpeedDrafts({});
    setSavedSpeeds({});
    setEditingPacing(true);
  }

  function cancelPacingEdit() {
    setSegWattsEdit({});
    setSegSpeedEdit({});
    setSpeedDrafts({});
    setEditingPacing(false);
  }

  // ── Save: apply edits + persist in one step ──
  function saveAndPersist() {
    if (!profile) return;

    const effectiveWatts = { ...segWattsEdit };
    if (route) {
      for (const seg of baseSegments) {
        const k = segKey(seg);
        const rawSpeed = k in speedDrafts ? parseFloat(speedDrafts[k])
                       : k in segSpeedEdit ? segSpeedEdit[k]
                       : NaN;
        if (!isNaN(rawSpeed) && rawSpeed > 0 && !(k in effectiveWatts)) {
          const w = wattsForSegmentSpeed(
            route.stream_distance_km, route.stream_altitude_m,
            seg.start_km, seg.end_km, rawSpeed, riderKg, bikeKg, physicsParams,
          );
          if (w > 0) effectiveWatts[k] = w;
        }
      }
    }

    const newClimbs = climbs.map((c, i) => {
      const k = `climb-${i}`;
      return k in effectiveWatts ? { ...c, target_watts: effectiveWatts[k] } : c;
    });
    const avg = (segs: PacingSegment[]) => {
      const vals = segs.map(s => effectiveWatts[segKey(s)]).filter((w): w is number => w !== undefined);
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    };
    const newFlat    = avg(baseSegments.filter(s => s.type === 'flat'))    ?? flatWatts;
    const newDescent = avg(baseSegments.filter(s => s.type === 'descent')) ?? descentWatts;

    const newSavedSpeeds = { ...savedSpeeds };
    for (const seg of baseSegments) {
      const k = segKey(seg);
      const spd = k in speedDrafts ? parseFloat(speedDrafts[k])
                : k in segSpeedEdit ? segSpeedEdit[k]
                : NaN;
      if (!isNaN(spd) && spd > 0) newSavedSpeeds[k] = spd;
    }

    setClimbs(newClimbs);
    setFlatWatts(newFlat);
    setDescentWatts(newDescent);
    setSavedSpeeds(newSavedSpeeds);
    setSegWattsEdit({});
    setSegSpeedEdit({});
    setSpeedDrafts({});
    setEditingPacing(false);

    const strategy: PacingStrategy | null = route
      ? {
          flat_watts: newFlat, flat_speed_kmh: flatSpeedKmh,
          descent_watts: newDescent, descent_speed_kmh: descentSpeedKmh,
          bike_weight_kg: bikeKg, accessories_kg: accessoriesKg, cda,
          climbs: newClimbs, est_time_min: estMin,
        }
      : event?.pacing_strategy ?? null;
    const updated: EventGoal = {
      id: eventId, name: event?.name ?? '', date: event?.date ?? '',
      location: event?.location, goal: event?.goal ?? '',
      strava_route_id: route?.id ?? event?.strava_route_id,
      route: route ?? event?.route ?? null, pacing_strategy: strategy,
      linked_activity_ids: event?.linked_activity_ids,
    };
    const events = profile.events.map(e => (e.id ?? '') === eventId ? updated : e);
    setProfile({ ...profile, events });
    save({ ...profile, events });
  }

  if (!profile) {
    return (
      <div className="h-full flex flex-col">
        <PageHeader icon={iconFor('events')} title="Pacing Strategy" />
        <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <PageHeader icon={iconFor('events')} title="Pacing Strategy" />

      <div className="flex-shrink-0 px-4 md:px-8 py-2 border-b border-gray-800/60">
        <Link href={`/events/${eventId}`} className="text-sm text-gray-500 hover:text-orange-400 transition-colors">
          ← {eventName || 'Event'}
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto scroll-touch">
        <div className="max-w-2xl mx-auto px-4 py-4 md:px-8 md:py-6 space-y-4">

          {!route && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 text-center">
              <p className="text-gray-500 text-sm">No Strava course loaded — add one in the event editor.</p>
              <Link href={`/events/${eventId}`} className="mt-3 inline-block text-orange-400 hover:text-orange-300 text-sm">
                Edit event →
              </Link>
            </div>
          )}

          {/* ── Pacing Strategy ────────────────────────────────────── */}
          {route && segments.length > 0 && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">

              {/* ── Top summary ── */}
              <div className="p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Pacing Strategy</h2>
                  <button
                    onClick={editingPacing ? cancelPacingEdit : startPacingEdit}
                    className="flex-shrink-0 text-xs text-orange-400 hover:text-orange-300 border border-orange-500/30 hover:border-orange-500/60 rounded-lg px-3 py-1.5 transition-colors"
                  >
                    {editingPacing ? 'Cancel' : 'Edit'}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div className="bg-gray-800/60 rounded-xl p-3 text-center col-span-1">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Est Time</p>
                    <p className="text-2xl font-bold text-white tabular-nums">{fmtTime(estMin)}</p>
                  </div>
                  <div className="bg-gray-800/60 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Avg Power</p>
                    <p className="text-2xl font-bold text-orange-400 tabular-nums">{avgWatts ?? '—'}<span className="text-sm font-normal text-gray-500 ml-0.5">W</span></p>
                  </div>
                  <div className="bg-gray-800/60 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">NP</p>
                    <p className="text-2xl font-bold text-yellow-400 tabular-nums">{np ?? '—'}<span className="text-sm font-normal text-gray-500 ml-0.5">W</span></p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Avg Speed', value: avgSpeedKmh ? `${avgSpeedKmh} km/h` : '—' },
                    { label: 'Calories',  value: calories ? `${calories.toLocaleString()} kcal` : '—' },
                    { label: 'Descent',   value: `-${totalDescM.toLocaleString()}m` },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-gray-800/40 rounded-lg px-2 py-1.5 text-center">
                      <p className="text-[9px] text-gray-600 uppercase tracking-wider">{label}</p>
                      <p className="text-xs font-semibold text-gray-300 tabular-nums mt-0.5">{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Terrain breakdown ── */}
              <div className="border-t border-gray-800 px-4 py-3 grid grid-cols-4 gap-2">
                {[
                  { label: 'Climbing',   value: fmtTime(climbMin),   pct: estMin > 0 ? Math.round(climbMin   / estMin * 100) : 0, color: 'text-orange-400', dot: 'bg-orange-500/70' },
                  { label: 'Descending', value: fmtTime(descentMin), pct: estMin > 0 ? Math.round(descentMin / estMin * 100) : 0, color: 'text-blue-400',   dot: 'bg-blue-500/70'   },
                  { label: 'Rolling',    value: fmtTime(rollingMin), pct: estMin > 0 ? Math.round(rollingMin / estMin * 100) : 0, color: 'text-yellow-400', dot: 'bg-yellow-500/70' },
                  { label: 'Flat',       value: fmtTime(flatMin),    pct: estMin > 0 ? Math.round(flatMin    / estMin * 100) : 0, color: 'text-green-400',  dot: 'bg-green-500/70'  },
                ].map(({ label, value, pct, color, dot }) => (
                  <div key={label} className="text-center">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot} mb-0.5`} />
                    <p className="text-[9px] text-gray-600 uppercase tracking-wider leading-tight">{label}</p>
                    <p className={`text-xs font-bold tabular-nums ${color} mt-0.5`}>{value}</p>
                    <p className="text-[9px] text-gray-600">{pct}%</p>
                  </div>
                ))}
              </div>

              {/* ── Rider setup ── */}
              <div className="border-t border-gray-800 px-4 py-3">
                <p className="text-[9px] text-gray-600 uppercase tracking-wider mb-2">Rider Setup</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {/* Weight summary */}
                  <span className="text-xs text-gray-500">
                    {riderKg} kg rider · {bikeKg} kg bike
                  </span>

                  {/* Accessories weight */}
                  <label className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span>+ accessories</span>
                    {editingPacing ? (
                      <input
                        type="number"
                        value={accessoriesKg}
                        onChange={e => setAccessoriesKg(Math.max(0, parseFloat(e.target.value) || 0))}
                        step={0.5} min={0} max={10}
                        className="w-12 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-white text-right focus:outline-none focus:border-orange-500 tabular-nums"
                      />
                    ) : (
                      <span className="text-gray-400">{accessoriesKg}</span>
                    )}
                    <span>kg = <span className="text-gray-300 font-medium">{totalKg} kg</span> total</span>
                  </label>

                  {/* Air density note */}
                  {avgRouteAlt !== null && (
                    <span className="text-[10px] text-gray-600">
                      ρ {(physicsParams.rho ?? 1.225).toFixed(3)} kg/m³ @ {avgRouteAlt}m avg alt
                    </span>
                  )}
                </div>

                {/* CdA selector */}
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-gray-500 shrink-0">Position (CdA):</span>
                  <div className="flex gap-1 flex-wrap">
                    {CDA_PRESETS.map(p => (
                      <button
                        key={p.value}
                        onClick={() => editingPacing && setCda(p.value)}
                        className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                          Math.abs(cda - p.value) < 0.005
                            ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                            : editingPacing
                              ? 'bg-gray-800 text-gray-500 hover:text-gray-300 border border-transparent'
                              : 'bg-gray-800/50 text-gray-600 border border-transparent'
                        }`}
                      >
                        {p.label} <span className="opacity-60">({p.value})</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Scrollable segment table ── */}
              <div className="border-t border-gray-800 overflow-x-auto">
                <div className="min-w-[420px]">
                  <div className={`px-3 py-1.5 grid ${COLS} gap-2 text-[9px] font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-800/60`}>
                    <span>Segment</span>
                    <span className="text-right">Dist</span>
                    {/* GAIN column — shows total ascent for climbs/flat, net for descents */}
                    <span className="text-right" title="Total ascent (sum of all uphill within segment). May differ from Strava route map elevation (DEM); Strava activities use barometric altimeter which is more accurate in alpine terrain.">Gain ⓘ</span>
                    <span className="text-right">Power</span>
                    <span className="text-right">Speed</span>
                    <span className="text-right">Time</span>
                  </div>

                  <div className="divide-y divide-gray-800/40">
                    {segments.map((seg, i) => {
                      const { rowBg, label: labelColor } = segColors(seg);
                      const editWatts = getEditWatts(seg);
                      const dispSpeed = getDisplaySpeed(seg);

                      // Climbs: show total ascent (ascent_m) — matches Strava's reported figure.
                      // Other segments: show net elevation (can be negative for descents/rolling).
                      const gainDisplay = seg.type === 'climb'
                        ? `+${seg.ascent_m}m`
                        : seg.elevation_gain >= 0
                          ? `+${seg.elevation_gain}m`
                          : `${seg.elevation_gain}m`;
                      const gainColor = seg.elevation_gain >= 0 ? 'text-orange-400' : 'text-blue-400';

                      return (
                        <div key={i} className={`px-3 py-2 ${rowBg} grid ${COLS} items-center gap-2`}>
                          <div className="min-w-0">
                            <p className={`text-xs font-medium truncate ${labelColor}`}>{seg.label}</p>
                            <p className="text-[10px] text-gray-600">{seg.start_km}–{seg.end_km} km</p>
                          </div>
                          <span className="text-xs text-gray-500 text-right tabular-nums">{seg.distance_km}</span>
                          <span className={`text-xs text-right tabular-nums ${gainColor}`}>{gainDisplay}</span>
                          {editingPacing ? (
                            <input type="number" value={editWatts}
                              onChange={e => { const w = parseInt(e.target.value, 10); if (!isNaN(w) && w > 0) handleWattsChange(seg, w); }}
                              className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-white text-right focus:outline-none focus:border-orange-500 tabular-nums"
                              step={5} min={0} max={700} />
                          ) : (
                            <span className="text-xs text-gray-300 text-right tabular-nums">{seg.target_watts}W</span>
                          )}
                          {editingPacing ? (
                            <input type="number" value={dispSpeed}
                              onChange={e => setSpeedDraft(seg, e.target.value)}
                              onBlur={e => handleSpeedBlur(seg, e.target.value)}
                              className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-white text-right focus:outline-none focus:border-blue-500 tabular-nums"
                              step={0.5} min={1} max={120} />
                          ) : (
                            <span className="text-xs text-gray-400 text-right tabular-nums">{seg.avg_speed_kmh}</span>
                          )}
                          <span className="text-xs font-semibold text-white text-right tabular-nums">{fmtTime(seg.est_time_min)}</span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Totals row */}
                  <div className={`border-t-2 border-gray-700 px-3 py-2.5 grid ${COLS} items-center gap-2`}>
                    <span className="text-xs font-bold text-white uppercase tracking-wider">Total</span>
                    <span className="text-xs font-bold text-white text-right tabular-nums">{totalKm}</span>
                    <span className="text-xs font-bold text-orange-400 text-right tabular-nums">+{totalAscentM.toLocaleString()}m</span>
                    <span className="text-xs font-bold text-white text-right tabular-nums">{avgWatts ?? '—'}W</span>
                    <span className="text-xs font-bold text-white text-right tabular-nums">{avgSpeedKmh ?? '—'}</span>
                    <span className="text-xs font-bold text-white text-right tabular-nums">{fmtTime(estMin)}</span>
                  </div>
                </div>
              </div>

              {/* ── Save button ── */}
              <div className="border-t border-gray-800 px-4 py-3 flex items-center justify-end gap-2">
                {editingPacing && (
                  <button onClick={cancelPacingEdit}
                    className="px-4 py-2 rounded-lg bg-gray-800 text-gray-400 hover:text-gray-200 text-sm transition-colors">
                    Cancel
                  </button>
                )}
                <button onClick={saveAndPersist} disabled={saving}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${editingPacing ? 'bg-orange-500 hover:bg-orange-400 text-white' : 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30'}`}>
                  {saving ? 'Saving…' : editingPacing ? 'Save' : 'Save pacing'}
                </button>
              </div>

            </section>
          )}

          {route && segments.length === 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 text-center space-y-2">
              <p className="text-gray-500 text-sm">No climbs defined yet.</p>
              <p className="text-gray-600 text-xs">Set up key climbs on the event page to generate a segment breakdown.</p>
              <Link href={`/events/${eventId}`} className="inline-block mt-1 text-orange-400 hover:text-orange-300 text-sm transition-colors">
                ← Back to event
              </Link>
            </div>
          )}

          {/* ── Comparison table (when active) ── */}
          {compareData && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between border-b border-gray-800">
                <div>
                  <p className="text-xs font-semibold text-gray-300">{compareData.activity_name}</p>
                  <p className="text-[10px] text-gray-600 mt-0.5">
                    {fmtShortDate(compareData.activity_date)} · planned {fmtTime(compareData.total_planned_min)}
                    {compareData.total_actual_min != null && (
                      <> · actual {fmtTime(compareData.total_actual_min)}
                        {' '}
                        <span className={compareData.total_actual_min <= compareData.total_planned_min ? 'text-green-400' : 'text-red-400'}>
                          ({compareData.total_actual_min <= compareData.total_planned_min ? '−' : '+'}
                          {fmtTime(Math.abs(compareData.total_actual_min - compareData.total_planned_min))})
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <button onClick={() => { setCompareActivityId(null); setCompareData(null); }}
                  className="text-xs text-gray-600 hover:text-gray-400 transition-colors">✕ Close</button>
              </div>
              {!compareData.has_streams && (
                <div className="px-4 py-3 text-xs text-amber-400 bg-amber-500/5 border-b border-gray-800">
                  This activity has no detailed streams stored. Re-sync to fetch altitude and distance data.
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[480px]">
                  <thead>
                    <tr className="text-[9px] text-gray-600 uppercase tracking-wider border-b border-gray-800">
                      <th className="px-3 py-1.5 text-left font-semibold">Segment</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Plan W</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Act W</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Plan Time</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Act Time</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Δ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/40">
                    {compareData.segments.map((seg, i) => {
                      const diff = seg.actual_time_min != null
                        ? seg.actual_time_min - seg.planned_time_min : null;
                      const diffPct = diff != null ? diff / seg.planned_time_min : null;
                      const diffColor = diff == null ? 'text-gray-600'
                        : diff <= 0 ? 'text-green-400'
                        : diffPct! <= 0.05 ? 'text-amber-400'
                        : 'text-red-400';
                      return (
                        <tr key={i} className="hover:bg-gray-800/30">
                          <td className="px-3 py-1.5">
                            <p className="font-medium text-gray-300">{seg.label}</p>
                            <p className="text-[9px] text-gray-600">{seg.start_km}–{seg.end_km} km</p>
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-400">{seg.planned_watts}W</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-300">
                            {seg.actual_watts != null ? `${seg.actual_watts}W` : '—'}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-400">{fmtTime(seg.planned_time_min)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-300">
                            {seg.actual_time_min != null ? fmtTime(seg.actual_time_min) : '—'}
                          </td>
                          <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${diffColor}`}>
                            {diff == null ? '—'
                              : `${diff > 0 ? '+' : ''}${fmtTime(Math.abs(diff))}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ── Past Rides panel ── */}
          {route && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              <button
                onClick={() => {
                  const next = !showPastRides;
                  setShowPastRides(next);
                  if (next) loadMatchingActivities();
                }}
                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-800/40 transition-colors"
              >
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Past Rides on This Route
                  {linkedIds.length > 0 && (
                    <span className="ml-2 text-orange-400 normal-case">{linkedIds.length} linked</span>
                  )}
                </span>
                <span className="text-gray-600 text-xs">{showPastRides ? '▲' : '▼'}</span>
              </button>

              {showPastRides && (
                <div className="border-t border-gray-800">
                  {loadingRides ? (
                    <div className="px-4 py-6 text-center text-gray-600 text-xs">Finding matching activities…</div>
                  ) : matchingActivities?.length === 0 ? (
                    <div className="px-4 py-6 text-center">
                      <p className="text-gray-500 text-sm">No activities found within ±20% of route distance.</p>
                      <p className="text-gray-600 text-xs mt-1">Make sure your Strava activities are synced.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-800/40">
                      {matchingActivities?.map(act => {
                        const isLinked   = linkedIds.includes(act.id);
                        const isComparing = compareActivityId === act.id;
                        return (
                          <div key={act.id} className={`px-4 py-3 flex items-center gap-3 ${isLinked ? 'bg-orange-500/5' : ''}`}>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-gray-300 truncate">{act.name}</p>
                              <p className="text-[10px] text-gray-600 mt-0.5">
                                {fmtShortDate(act.start_date)} · {Math.round(act.distance_m / 100) / 10} km
                                {' · '}{fmtMovingTime(act.moving_time)}
                                {act.normalized_power && <> · {Math.round(act.normalized_power)}W NP</>}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {isLinked && (
                                <button
                                  onClick={() => loadComparison(act.id)}
                                  disabled={loadingCompare && !isComparing}
                                  className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                                    isComparing
                                      ? 'bg-blue-500/20 text-blue-400 border-blue-500/50'
                                      : 'border-gray-700 text-gray-500 hover:text-gray-300'
                                  }`}
                                >
                                  {loadingCompare && isComparing ? 'Loading…' : isComparing ? 'Comparing' : 'Compare'}
                                </button>
                              )}
                              <button
                                onClick={() => toggleLink(act.id)}
                                className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                                  isLinked
                                    ? 'bg-orange-500/10 text-orange-400 border-orange-500/30 hover:bg-orange-500/20'
                                    : 'border-gray-700 text-gray-600 hover:text-gray-300'
                                }`}
                              >
                                {isLinked ? 'Linked ✓' : 'Link'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
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
