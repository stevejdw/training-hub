'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { EventGoal, EventClimb, CachedRoute, PacingStrategy } from '@/lib/profile';
import {
  buildPacingSegments, calcNP, calcAvgWatts, calcCalories, estimateTime,
  fmtTime, speedForPower, powerForSpeed, PacingSegment,
} from '@/lib/pacing';
import PageHeader from '@/components/PageHeader';
import { iconFor } from '@/components/nav-items';
import { useProfileEdit, inputCls } from '@/lib/use-profile-edit';

const DEFAULT_FLAT_WATTS    = 260;
const DEFAULT_DESCENT_WATTS = 120;


// Unique key per segment
function segKey(seg: PacingSegment): string {
  return seg.type === 'climb' ? `climb-${seg.climb_idx}` : `${seg.type}-${seg.start_km}`;
}

// Rolling = flat-type but noticeably undulating (|gradient| ≥ 1%)
function isRolling(seg: PacingSegment) {
  return seg.type === 'flat' && Math.abs(seg.avg_gradient) >= 1;
}

function segColors(seg: PacingSegment) {
  if (seg.type === 'climb')   return { rowBg: 'bg-orange-500/8',  label: 'text-orange-300', dot: 'bg-orange-500/70',  name: 'Climbing'    };
  if (seg.type === 'descent') return { rowBg: 'bg-blue-500/8',    label: 'text-blue-300',   dot: 'bg-blue-500/70',    name: 'Descending'  };
  if (isRolling(seg))         return { rowBg: 'bg-yellow-500/5',  label: 'text-yellow-300', dot: 'bg-yellow-500/70',  name: 'Rolling'     };
  return                             { rowBg: '',                  label: 'text-green-300',  dot: 'bg-green-500/70',   name: 'Flat'        };
}

const COLS = 'grid-cols-[1fr_48px_52px_68px_70px_52px]';

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

  // ── Edit modes ──
  const [editingPacing, setEditingPacing] = useState(false);

  // ── Inline segment edit state ──
  // Per-segment watts overrides while in edit mode (before "Save")
  const [segWattsEdit, setSegWattsEdit] = useState<Record<string, number>>({});
  // Per-segment speed draft (string, only set while input is focused)
  const [speedDrafts, setSpeedDrafts] = useState<Record<string, string>>({});

  const riderKg = profile?.weight_kg      ?? 75;
  const bikeKg  = profile?.bike_weight_kg ?? 8;
  const totalKg = riderKg + bikeKg;
  const eventName = event?.name ?? '';

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
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventIdx >= 0]);


  // ── Derived segments ──
  // Base segments use saved watts; per-segment overrides are applied on top.
  const baseSegments = useMemo(() => {
    if (!route || climbs.length === 0) return [];
    return buildPacingSegments(
      route.stream_distance_km, route.stream_altitude_m,
      route.distance_m / 1000, climbs,
      flatWatts, descentWatts, riderKg, bikeKg,
      descentSpeedKmh, flatSpeedKmh,
    );
  }, [route, climbs, flatWatts, descentWatts, riderKg, bikeKg, descentSpeedKmh, flatSpeedKmh]);

  // Apply per-segment watt overrides when editing
  const segments = useMemo(() => {
    if (!editingPacing || Object.keys(segWattsEdit).length === 0) return baseSegments;
    return baseSegments.map(seg => {
      const k = segKey(seg);
      if (!(k in segWattsEdit)) return seg;
      const watts   = segWattsEdit[k];
      const speedMs = speedForPower(watts, seg.avg_gradient / 100, totalKg);
      if (speedMs <= 0) return seg;
      const speedKmh = Math.round(speedMs * 36) / 10;
      const timeMin  = (seg.distance_km * 1000 / speedMs) / 60;
      return { ...seg, target_watts: watts, avg_speed_kmh: speedKmh, est_time_min: timeMin };
    });
  }, [baseSegments, editingPacing, segWattsEdit, totalKg]);

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

  // ── Segment edit helpers ──
  function getEditWatts(seg: PacingSegment): number {
    const k = segKey(seg);
    if (editingPacing && k in segWattsEdit) return segWattsEdit[k];
    return seg.target_watts;
  }

  function handleWattsChange(seg: PacingSegment, w: number) {
    const k = segKey(seg);
    setSegWattsEdit(prev => ({ ...prev, [k]: w }));
    setSpeedDrafts(prev => { const n = { ...prev }; delete n[k]; return n; });
  }

  function getDisplaySpeed(seg: PacingSegment): string {
    const k = segKey(seg);
    if (k in speedDrafts) return speedDrafts[k];
    // Show speed derived from current edit watts if overridden
    if (editingPacing && k in segWattsEdit) {
      const ms = speedForPower(segWattsEdit[k], seg.avg_gradient / 100, totalKg);
      return String(Math.round(ms * 36) / 10);
    }
    return String(seg.avg_speed_kmh);
  }

  function setSpeedDraft(seg: PacingSegment, val: string) {
    setSpeedDrafts(prev => ({ ...prev, [segKey(seg)]: val }));
  }

  function handleSpeedBlur(seg: PacingSegment, draftValue: string) {
    const k = segKey(seg);
    const s = parseFloat(draftValue);
    if (!isNaN(s) && s > 0) {
      const w = powerForSpeed(s / 3.6, seg.avg_gradient / 100, totalKg);
      if (w > 0) setSegWattsEdit(prev => ({ ...prev, [k]: w }));
    }
    setSpeedDrafts(prev => { const n = { ...prev }; delete n[k]; return n; });
  }

  function startPacingEdit() {
    setSegWattsEdit({});
    setSpeedDrafts({});
    setEditingPacing(true);
  }

  function cancelPacingEdit() {
    setSegWattsEdit({});
    setSpeedDrafts({});
    setEditingPacing(false);
  }

  function savePacingEdit() {
    // Persist climb-specific changes
    setClimbs(prev => prev.map((c, i) => {
      const k = `climb-${i}`;
      return k in segWattsEdit ? { ...c, target_watts: segWattsEdit[k] } : c;
    }));
    // For flat/descent, average all edited segments of that type as new global default
    const flatEdits    = baseSegments.filter(s => s.type === 'flat').map(s => segWattsEdit[segKey(s)]).filter((w): w is number => w !== undefined);
    const descentEdits = baseSegments.filter(s => s.type === 'descent').map(s => segWattsEdit[segKey(s)]).filter((w): w is number => w !== undefined);
    if (flatEdits.length)    setFlatWatts(Math.round(flatEdits.reduce((a, b) => a + b, 0) / flatEdits.length));
    if (descentEdits.length) setDescentWatts(Math.round(descentEdits.reduce((a, b) => a + b, 0) / descentEdits.length));
    setSegWattsEdit({});
    setSpeedDrafts({});
    setEditingPacing(false);
  }

  // ── Persist ──
  const buildUpdatedEvent = useCallback((): EventGoal => {
    const strategy: PacingStrategy | null = route
      ? { flat_watts: flatWatts, flat_speed_kmh: flatSpeedKmh, descent_watts: descentWatts,
          descent_speed_kmh: descentSpeedKmh, bike_weight_kg: bikeKg, climbs, est_time_min: estMin }
      : event?.pacing_strategy ?? null;
    return {
      id: eventId, name: event?.name ?? '', date: event?.date ?? '',
      location: event?.location, goal: event?.goal ?? '',
      strava_route_id: route?.id ?? event?.strava_route_id,
      route: route ?? event?.route ?? null, pacing_strategy: strategy,
    };
  }, [eventId, event, route, flatWatts, descentWatts, bikeKg, climbs, estMin, flatSpeedKmh, descentSpeedKmh]);

  function persistEvent() {
    if (!profile) return;
    const updated = buildUpdatedEvent();
    const events  = profile.events.map(e => (e.id ?? '') === eventId ? updated : e);
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
              {/* Summary header */}
              <div className="p-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Segment Pacing</h2>
                  {estMin > 0 && (
                    <p className="text-sm text-gray-300 mt-0.5">
                      {fmtTime(estMin)} est{avgWatts ? ` · ${avgWatts}W avg` : ''}{np ? ` · ${np} NP` : ''}
                    </p>
                  )}
                </div>
                <button
                  onClick={editingPacing ? cancelPacingEdit : startPacingEdit}
                  className="flex-shrink-0 text-xs text-orange-400 hover:text-orange-300 border border-orange-500/30 hover:border-orange-500/60 rounded-lg px-3 py-1.5 transition-colors"
                >
                  {editingPacing ? 'Cancel' : 'Edit'}
                </button>
              </div>

              {/* Column headers — single fixed layout for both view + edit */}
              <div className={`border-t border-gray-800 px-3 py-1.5 grid ${COLS} gap-2 text-[9px] font-semibold text-gray-600 uppercase tracking-wider`}>
                <span>Segment</span>
                <span className="text-right">Dist</span>
                <span className="text-right">Gain</span>
                <span className="text-right">Power</span>
                <span className="text-right">Speed</span>
                <span className="text-right">Time</span>
              </div>

              {/* Segment rows */}
              <div className="divide-y divide-gray-800/40">
                {segments.map((seg, i) => {
                  const { rowBg, label: labelColor } = segColors(seg);
                  const editWatts = getEditWatts(seg);
                  const dispSpeed = getDisplaySpeed(seg);

                  return (
                    <div key={i} className={`px-3 py-2 ${rowBg} grid ${COLS} items-center gap-2`}>
                      {/* Label */}
                      <div className="min-w-0">
                        <p className={`text-xs font-medium truncate ${labelColor}`}>{seg.label}</p>
                        <p className="text-[10px] text-gray-600">{seg.start_km}–{seg.end_km} km</p>
                      </div>

                      {/* Distance */}
                      <span className="text-xs text-gray-500 text-right tabular-nums">{seg.distance_km}</span>

                      {/* Elevation */}
                      <span className={`text-xs text-right tabular-nums ${seg.elevation_gain >= 0 ? 'text-orange-400' : 'text-blue-400'}`}>
                        {seg.elevation_gain >= 0 ? '+' : ''}{seg.elevation_gain}m
                      </span>

                      {/* Watts */}
                      {editingPacing ? (
                        <input
                          type="number"
                          value={editWatts}
                          onChange={e => { const w = parseInt(e.target.value, 10); if (!isNaN(w) && w > 0) handleWattsChange(seg, w); }}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-white text-right focus:outline-none focus:border-orange-500 tabular-nums"
                          step={5} min={0} max={700}
                        />
                      ) : (
                        <span className="text-xs text-gray-300 text-right tabular-nums">{seg.target_watts}W</span>
                      )}

                      {/* Speed */}
                      {editingPacing ? (
                        <input
                          type="number"
                          value={dispSpeed}
                          onChange={e => setSpeedDraft(seg, e.target.value)}
                          onBlur={e => handleSpeedBlur(seg, e.target.value)}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-white text-right focus:outline-none focus:border-blue-500 tabular-nums"
                          step={0.5} min={1} max={120}
                        />
                      ) : (
                        <span className="text-xs text-gray-400 text-right tabular-nums">{seg.avg_speed_kmh}</span>
                      )}

                      {/* Time */}
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

              {/* Save / terrain breakdown */}
              <div className="border-t border-gray-800 p-4 space-y-3">
                {/* Terrain breakdown */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Climbing',   value: fmtTime(climbMin),   pct: estMin > 0 ? Math.round(climbMin   / estMin * 100) : 0, color: 'text-orange-400', dot: 'bg-orange-500/70' },
                    { label: 'Descending', value: fmtTime(descentMin), pct: estMin > 0 ? Math.round(descentMin / estMin * 100) : 0, color: 'text-blue-400',   dot: 'bg-blue-500/70'   },
                    { label: 'Rolling',    value: fmtTime(rollingMin), pct: estMin > 0 ? Math.round(rollingMin / estMin * 100) : 0, color: 'text-yellow-400', dot: 'bg-yellow-500/70' },
                    { label: 'Flat',       value: fmtTime(flatMin),    pct: estMin > 0 ? Math.round(flatMin    / estMin * 100) : 0, color: 'text-green-400',  dot: 'bg-green-500/70'  },
                  ].map(({ label, value, pct, color, dot }) => (
                    <div key={label} className="bg-gray-800/50 rounded-lg p-2.5 text-center">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot} mb-1`} />
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider leading-tight">{label}</p>
                      <p className={`text-sm font-bold tabular-nums ${color} mt-0.5`}>{value}</p>
                      <p className="text-[10px] text-gray-600">{pct}%</p>
                    </div>
                  ))}
                </div>

                {/* Extra totals */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'NP',        value: np ? `${np}W` : '—' },
                    { label: 'Descent',   value: `-${totalDescM.toLocaleString()}m` },
                    { label: 'Calories',  value: calories ? `${calories.toLocaleString()} kcal` : '—' },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-gray-800/40 rounded-lg px-3 py-2 flex items-center justify-between">
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
                      <span className="text-sm font-semibold text-white tabular-nums">{value}</span>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-3 justify-between">
                  <p className="text-[10px] text-gray-600">{riderKg} kg rider · {bikeKg} kg bike · {totalKg} kg system</p>
                  <div className="flex gap-2">
                    {editingPacing && (
                      <button onClick={savePacingEdit}
                        className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-white text-sm font-medium transition-colors">
                        Apply
                      </button>
                    )}
                    <button onClick={persistEvent} disabled={saving}
                      className="px-4 py-2 rounded-lg bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 text-sm transition-colors disabled:opacity-50">
                      {saving ? 'Saving…' : 'Save pacing'}
                    </button>
                  </div>
                </div>
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

          <div className="h-20" />
        </div>
      </div>
    </div>
  );
}
