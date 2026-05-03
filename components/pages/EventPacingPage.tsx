'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { EventGoal, EventClimb, CachedRoute, PacingStrategy } from '@/lib/profile';
import {
  buildPacingSegments, calcNP, calcAvgWatts, calcCalories, estimateTime,
  fmtTime, powerForSpeed, PacingSegment,
} from '@/lib/pacing';
import PageHeader from '@/components/PageHeader';
import { iconFor } from '@/components/nav-items';
import { useProfileEdit, inputCls } from '@/lib/use-profile-edit';

const DEFAULT_FLAT_WATTS    = 260;
const DEFAULT_DESCENT_WATTS = 120;


// Segment key used to track per-segment state
function segKey(seg: PacingSegment): string {
  return seg.type === 'climb' ? `climb-${seg.climb_idx}` : `${seg.type}-${seg.start_km}`;
}

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
  // When editing pacing, merge per-segment watts overrides into climbs
  const activeClimbs = useMemo(() => {
    if (!editingPacing || Object.keys(segWattsEdit).length === 0) return climbs;
    return climbs.map((c, i) => {
      const key = `climb-${i}`;
      return key in segWattsEdit ? { ...c, target_watts: segWattsEdit[key] } : c;
    });
  }, [climbs, segWattsEdit, editingPacing]);

  const activeFlatWatts    = editingPacing && 'flat' in segWattsEdit    ? (segWattsEdit['flat'] ?? flatWatts)    : flatWatts;
  const activeDescentWatts = editingPacing && 'descent' in segWattsEdit ? (segWattsEdit['descent'] ?? descentWatts) : descentWatts;

  const segments = useMemo(() => {
    if (!route || activeClimbs.length === 0) return [];
    return buildPacingSegments(
      route.stream_distance_km, route.stream_altitude_m,
      route.distance_m / 1000, activeClimbs,
      activeFlatWatts, activeDescentWatts, riderKg, bikeKg,
      descentSpeedKmh, flatSpeedKmh,
    );
  }, [route, activeClimbs, activeFlatWatts, activeDescentWatts, riderKg, bikeKg, descentSpeedKmh, flatSpeedKmh]);

  const estMin    = useMemo(() => segments.reduce((t, s) => t + s.est_time_min, 0), [segments]);
  const np        = useMemo(() => segments.length ? calcNP(segments)       : null, [segments]);
  const avgWatts  = useMemo(() => segments.length ? calcAvgWatts(segments) : null, [segments]);
  const calories  = useMemo(() => avgWatts && estMin ? calcCalories(avgWatts, estMin) : null, [avgWatts, estMin]);

  const climbMin   = useMemo(() => segments.filter(s => s.type === 'climb').reduce((t, s) => t + s.est_time_min, 0), [segments]);
  const descentMin = useMemo(() => segments.filter(s => s.type === 'descent').reduce((t, s) => t + s.est_time_min, 0), [segments]);
  const flatMin    = useMemo(() => segments.filter(s => s.type === 'flat').reduce((t, s) => t + s.est_time_min, 0), [segments]);

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

  function setSegWatts(seg: PacingSegment, w: number) {
    // Map flat segments to a single 'flat' key, descents to 'descent'
    let k = segKey(seg);
    if (seg.type === 'flat') k = 'flat';
    else if (seg.type === 'descent') k = 'descent';
    setSegWattsEdit(prev => ({ ...prev, [k]: w }));
    // Clear speed draft for this key since watts takes priority
    setSpeedDrafts(prev => { const n = { ...prev }; delete n[k]; return n; });
  }

  function handleWattsChange(seg: PacingSegment, w: number) {
    setSegWatts(seg, w);
  }

  function handleSpeedBlur(seg: PacingSegment, draftValue: string) {
    const s = parseFloat(draftValue);
    if (!isNaN(s) && s > 0) {
      const grad = seg.avg_gradient / 100;
      const w    = powerForSpeed(s / 3.6, grad, totalKg);
      if (w > 0) setSegWatts(seg, w);
    }
    // Clear draft
    const k = seg.type === 'flat' ? 'flat' : seg.type === 'descent' ? 'descent' : segKey(seg);
    setSpeedDrafts(prev => { const n = { ...prev }; delete n[k]; return n; });
  }

  function getDisplaySpeed(seg: PacingSegment): string {
    const k = seg.type === 'flat' ? 'flat' : seg.type === 'descent' ? 'descent' : segKey(seg);
    if (k in speedDrafts) return speedDrafts[k];
    return String(seg.avg_speed_kmh);
  }

  function setSpeedDraft(seg: PacingSegment, val: string) {
    const k = seg.type === 'flat' ? 'flat' : seg.type === 'descent' ? 'descent' : segKey(seg);
    setSpeedDrafts(prev => ({ ...prev, [k]: val }));
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
    // Merge segWattsEdit back into state
    if ('flat' in segWattsEdit)    setFlatWatts(segWattsEdit['flat']);
    if ('descent' in segWattsEdit) setDescentWatts(segWattsEdit['descent']);
    setClimbs(prev => prev.map((c, i) => {
      const k = `climb-${i}`;
      return k in segWattsEdit ? { ...c, target_watts: segWattsEdit[k] } : c;
    }));
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

              {/* Column headers */}
              <div className={`border-t border-gray-800 px-3 py-1.5 grid gap-2 text-[9px] font-semibold text-gray-600 uppercase tracking-wider ${editingPacing ? 'grid-cols-[1fr_52px_52px_72px_72px_52px]' : 'grid-cols-[1fr_52px_52px_52px_56px_52px]'}`}>
                <span>Segment</span>
                <span className="text-right">Dist</span>
                <span className="text-right">Gain</span>
                <span className="text-right">{editingPacing ? 'Power (W)' : 'Power'}</span>
                <span className="text-right">{editingPacing ? 'Speed km/h' : 'Speed'}</span>
                <span className="text-right">Time</span>
              </div>

              {/* Segment rows */}
              <div className="divide-y divide-gray-800/40">
                {segments.map((seg, i) => {
                  const isClimb   = seg.type === 'climb';
                  const isDescent = seg.type === 'descent';
                  const labelColor = isClimb ? 'text-orange-300' : isDescent ? 'text-blue-300' : 'text-gray-300';
                  const rowBg = isClimb ? 'bg-orange-500/5' : isDescent ? 'bg-blue-500/5' : '';
                  const editWatts  = getEditWatts(seg);
                  const dispSpeed  = getDisplaySpeed(seg);

                  return (
                    <div key={i} className={`px-3 py-2 ${rowBg} ${editingPacing ? 'grid grid-cols-[1fr_52px_52px_72px_72px_52px]' : 'grid grid-cols-[1fr_52px_52px_52px_56px_52px]'} items-center gap-2`}>
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

                      {/* Watts — editable */}
                      {editingPacing ? (
                        <input
                          type="number"
                          value={editWatts}
                          onChange={e => {
                            const w = parseInt(e.target.value, 10);
                            if (!isNaN(w) && w > 0) handleWattsChange(seg, w);
                          }}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-white text-right focus:outline-none focus:border-orange-500 tabular-nums"
                          step={5} min={0} max={700}
                        />
                      ) : (
                        <span className="text-xs text-gray-300 text-right tabular-nums">{seg.target_watts}W</span>
                      )}

                      {/* Speed — editable with draft */}
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
              <div className={`border-t-2 border-gray-700 px-3 py-2.5 ${editingPacing ? 'grid grid-cols-[1fr_52px_52px_72px_72px_52px]' : 'grid grid-cols-[1fr_52px_52px_52px_56px_52px]'} items-center gap-2`}>
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
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Climbing',        value: fmtTime(climbMin),   pct: estMin > 0 ? Math.round(climbMin / estMin * 100) : 0,   color: 'text-orange-400', dot: 'bg-orange-500/60' },
                    { label: 'Descending',      value: fmtTime(descentMin), pct: estMin > 0 ? Math.round(descentMin / estMin * 100) : 0, color: 'text-blue-400',   dot: 'bg-blue-500/60' },
                    { label: 'Flat / Rolling',  value: fmtTime(flatMin),    pct: estMin > 0 ? Math.round(flatMin / estMin * 100) : 0,    color: 'text-gray-400',   dot: 'bg-gray-500/60' },
                  ].map(({ label, value, pct, color, dot }) => (
                    <div key={label} className="bg-gray-800/50 rounded-lg p-2.5 text-center">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot} mb-1`} />
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider leading-tight">{label}</p>
                      <p className={`text-base font-bold tabular-nums ${color} mt-0.5`}>{value}</p>
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
