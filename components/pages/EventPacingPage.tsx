'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { EventGoal, EventClimb, CachedRoute, PacingStrategy } from '@/lib/profile';
import {
  buildPacingSegments, calcNP, calcAvgWatts, calcCalories, estimateTime,
  fmtTime, speedForPower, powerForSpeed, detectClimbs, PacingSegment,
} from '@/lib/pacing';
import PageHeader from '@/components/PageHeader';
import { iconFor } from '@/components/nav-items';
import { useProfileEdit, inputCls } from '@/lib/use-profile-edit';

const DEFAULT_FLAT_WATTS    = 260;
const DEFAULT_DESCENT_WATTS = 120;

const PEAKS_CHALLENGE_BOUNDS = [
  { name: 'Climb 1 – Tawonga Gap',  start_km:  33.6, end_km:  40.7 },
  { name: 'Mt Hotham 1',            start_km:  73.9, end_km:  83.9 },
  { name: 'Mt Hotham 2',            start_km:  83.9, end_km:  93.9 },
  { name: 'Mt Hotham 3',            start_km:  93.9, end_km: 103.9 },
  { name: 'Climb 5',                start_km: 146.7, end_km: 149.2 },
  { name: 'Climb 6',                start_km: 166.6, end_km: 174.0 },
  { name: 'Climb 7',                start_km: 200.0, end_km: 210.0 },
  { name: 'Climb 8 – Falls Creek', start_km: 215.0, end_km: 224.0 },
] as const;

function climbFromBounds(
  route: CachedRoute, name: string, startKm: number, endKm: number, targetWatts: number,
): EventClimb {
  const d = route.stream_distance_km;
  const a = route.stream_altitude_m;
  let firstAlt: number | null = null, lastAlt = 0;
  for (let i = 0; i < d.length; i++) {
    if (d[i] < startKm || d[i] > endKm) continue;
    if (firstAlt === null) firstAlt = a[i];
    lastAlt = a[i];
  }
  const dist    = Math.round((endKm - startKm) * 10) / 10;
  const net     = firstAlt !== null ? lastAlt - firstAlt : 0;
  const avgGrad = dist > 0 ? Math.round((net / (dist * 1000)) * 1000) / 10 : 0;
  return {
    name, start_km: Math.round(startKm * 10) / 10, end_km: Math.round(endKm * 10) / 10,
    distance_km: dist, elevation_gain: Math.round(net), avg_gradient: avgGrad, target_watts: targetWatts,
  };
}

function computeClimbStats(route: CachedRoute, startKm: number, endKm: number) {
  const d = route.stream_distance_km, a = route.stream_altitude_m;
  let firstAlt: number | null = null, lastAlt = 0;
  for (let i = 0; i < d.length; i++) {
    if (d[i] < startKm || d[i] > endKm) continue;
    if (firstAlt === null) firstAlt = a[i];
    lastAlt = a[i];
  }
  const dist    = Math.round((endKm - startKm) * 10) / 10;
  const net     = firstAlt !== null ? lastAlt - firstAlt : 0;
  const avgGrad = dist > 0 ? Math.round((net / (dist * 1000)) * 1000) / 10 : 0;
  return { distance_km: dist, elevation_gain: Math.round(net), avg_gradient: avgGrad };
}

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
  const [autoDetected,    setAutoDetected]    = useState(false);
  const [flatWatts,       setFlatWatts]       = useState(DEFAULT_FLAT_WATTS);
  const [descentWatts,    setDescentWatts]    = useState(DEFAULT_DESCENT_WATTS);
  const [descentSpeedKmh, setDescentSpeedKmh] = useState<number | undefined>(undefined);
  const [flatSpeedKmh,    setFlatSpeedKmh]    = useState<number | undefined>(undefined);

  // ── Edit modes ──
  const [editingClimbs,  setEditingClimbs]  = useState(false);
  const [editingPacing,  setEditingPacing]  = useState(false);

  // ── Climb editor state ──
  const [editingClimbIdx, setEditingClimbIdx] = useState<number | null>(null);
  const [editClimbForm,   setEditClimbForm]   = useState({ name: '', start_km: '', end_km: '', target_watts: '' });
  const [showAddClimb,    setShowAddClimb]    = useState(false);
  const [addStart,        setAddStart]        = useState('');
  const [addEnd,          setAddEnd]          = useState('');

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
      setAutoDetected(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventIdx >= 0]);

  // ── Auto-detect climbs ──
  useEffect(() => {
    if (!route || autoDetected) return;
    if (climbs.length > 0) { setAutoDetected(true); return; }
    const defaultWatts = Math.round(flatWatts * 0.88);
    if (eventName.toLowerCase().includes('peaks challenge')) {
      setClimbs(PEAKS_CHALLENGE_BOUNDS.map(b =>
        climbFromBounds(route, b.name, b.start_km, b.end_km, defaultWatts)
      ));
    } else {
      const detected = detectClimbs(route.stream_distance_km, route.stream_altitude_m);
      setClimbs(detected.map((c, i) => ({ ...c, name: `Climb ${i + 1}`, target_watts: defaultWatts })));
    }
    setAutoDetected(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

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

  // ── Climb management ──
  function deleteClimb(i: number) {
    setClimbs(prev => prev.filter((_, idx) => idx !== i).map((c, idx) => ({ ...c, name: `Climb ${idx + 1}` })));
    setEditingClimbIdx(null);
  }

  function resetClimbs() {
    if (!route) return;
    const defaultWatts = Math.round(flatWatts * 0.88);
    if (eventName.toLowerCase().includes('peaks challenge')) {
      setClimbs(PEAKS_CHALLENGE_BOUNDS.map(b => climbFromBounds(route, b.name, b.start_km, b.end_km, defaultWatts)));
    } else {
      const detected = detectClimbs(route.stream_distance_km, route.stream_altitude_m);
      setClimbs(detected.map((c, i) => ({ ...c, name: `Climb ${i + 1}`, target_watts: defaultWatts })));
    }
    setShowAddClimb(false); setEditingClimbIdx(null);
  }

  function addCustomClimb() {
    if (!route) return;
    const s = parseFloat(addStart), e = parseFloat(addEnd);
    if (isNaN(s) || isNaN(e) || e <= s) return;
    const stats = computeClimbStats(route, s, e);
    const newClimb: EventClimb = {
      ...stats, name: '', start_km: Math.round(s * 10) / 10, end_km: Math.round(e * 10) / 10,
      target_watts: Math.round(flatWatts * 0.88),
    };
    setClimbs(prev => [...prev, newClimb]
      .sort((a, b) => a.start_km - b.start_km)
      .map((c, i) => ({ ...c, name: c.name || `Climb ${i + 1}` }))
    );
    setAddStart(''); setAddEnd(''); setShowAddClimb(false);
  }

  function openClimbEdit(i: number) {
    const c = climbs[i];
    setEditingClimbIdx(i);
    setEditClimbForm({ name: c.name, start_km: String(c.start_km), end_km: String(c.end_km), target_watts: String(c.target_watts) });
  }

  function saveClimbEdit() {
    if (editingClimbIdx === null || !route) return;
    const s = parseFloat(editClimbForm.start_km), e = parseFloat(editClimbForm.end_km);
    if (isNaN(s) || isNaN(e) || e <= s) return;
    const stats = computeClimbStats(route, s, e);
    setClimbs(prev => {
      const next = [...prev];
      next[editingClimbIdx] = {
        ...stats, name: editClimbForm.name || `Climb ${editingClimbIdx + 1}`,
        start_km: Math.round(s * 10) / 10, end_km: Math.round(e * 10) / 10,
        target_watts: Number(editClimbForm.target_watts) || flatWatts,
      };
      return next;
    });
    setEditingClimbIdx(null);
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

          {/* ── Key Climbs ────────────────────────────────────────── */}
          {route && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between p-4">
                <div>
                  <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Key Climbs</h2>
                  <p className="text-sm text-gray-300 mt-0.5">
                    {climbs.length > 0
                      ? `${climbs.length} climb${climbs.length !== 1 ? 's' : ''} · ${climbs.reduce((s, c) => s + c.elevation_gain, 0).toLocaleString()} m total ascent`
                      : 'No climbs detected'}
                  </p>
                </div>
                <button
                  onClick={() => { setEditingClimbs(e => !e); setEditingClimbIdx(null); setShowAddClimb(false); }}
                  className="text-xs text-orange-400 hover:text-orange-300 border border-orange-500/30 hover:border-orange-500/60 rounded-lg px-3 py-1.5 transition-colors"
                >
                  {editingClimbs ? 'Done' : 'Edit'}
                </button>
              </div>

              {climbs.length > 0 && (
                <div className="border-t border-gray-800 divide-y divide-gray-800/60">
                  {climbs.map((c, i) => {
                    const isEditing = editingClimbs && editingClimbIdx === i;
                    return (
                      <div key={i} className={isEditing ? 'bg-gray-800/40' : ''}>
                        {isEditing ? (
                          <div className="p-3 space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                              <div className="col-span-2">
                                <label className="text-[9px] text-gray-600 uppercase tracking-wider block mb-1">Name</label>
                                <input type="text" value={editClimbForm.name}
                                  onChange={e => setEditClimbForm(f => ({ ...f, name: e.target.value }))}
                                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-orange-500" />
                              </div>
                              <div>
                                <label className="text-[9px] text-gray-600 uppercase tracking-wider block mb-1">Start km</label>
                                <input type="number" value={editClimbForm.start_km} step="0.1" min="0"
                                  onChange={e => setEditClimbForm(f => ({ ...f, start_km: e.target.value }))}
                                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-orange-500" />
                              </div>
                              <div>
                                <label className="text-[9px] text-gray-600 uppercase tracking-wider block mb-1">End km</label>
                                <input type="number" value={editClimbForm.end_km} step="0.1" min="0"
                                  onChange={e => setEditClimbForm(f => ({ ...f, end_km: e.target.value }))}
                                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-orange-500" />
                              </div>
                              <div className="col-span-2">
                                <label className="text-[9px] text-gray-600 uppercase tracking-wider block mb-1">Target watts</label>
                                <input type="number" value={editClimbForm.target_watts} step="5" min="50" max="600"
                                  onChange={e => setEditClimbForm(f => ({ ...f, target_watts: e.target.value }))}
                                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-orange-500" />
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <button onClick={() => deleteClimb(i)} className="text-xs text-red-400 hover:text-red-300 transition-colors">Remove climb</button>
                              <div className="flex gap-2">
                                <button onClick={() => setEditingClimbIdx(null)} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Cancel</button>
                                <button onClick={saveClimbEdit} className="px-3 py-1 rounded-lg bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 text-xs transition-colors">Save</button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3 px-3 py-2.5">
                            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-gray-800 flex items-center justify-center text-[10px] font-bold text-gray-400">{i + 1}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-white truncate">{c.name}</p>
                              <p className="text-[11px] text-gray-500 mt-0.5">
                                {c.start_km} km · {c.distance_km} km · <span className="text-orange-400">+{c.elevation_gain} m</span> · {c.avg_gradient}%
                              </p>
                            </div>
                            {editingClimbs && (
                              <button onClick={() => openClimbEdit(i)}
                                className="flex-shrink-0 text-xs text-orange-400 hover:text-orange-300 border border-orange-500/30 rounded px-2 py-0.5 transition-colors">
                                Edit
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {editingClimbs && (
                <div className="p-3 border-t border-gray-800/60">
                  {showAddClimb ? (
                    <div className="space-y-2">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider">Add climb</p>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <label className="text-[9px] text-gray-600 uppercase tracking-wider block mb-1">Start km</label>
                          <input type="number" value={addStart} onChange={e => setAddStart(e.target.value)} placeholder="e.g. 73.9"
                            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-orange-500" step="0.1" min="0" />
                        </div>
                        <div className="flex-1">
                          <label className="text-[9px] text-gray-600 uppercase tracking-wider block mb-1">End km</label>
                          <input type="number" value={addEnd} onChange={e => setAddEnd(e.target.value)} placeholder="e.g. 83.9"
                            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-orange-500" step="0.1" min="0" />
                        </div>
                        <button onClick={addCustomClimb} disabled={!addStart || !addEnd}
                          className="flex-shrink-0 mt-4 px-3 py-1.5 bg-orange-500 hover:bg-orange-400 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors">Add</button>
                        <button onClick={() => { setShowAddClimb(false); setAddStart(''); setAddEnd(''); }}
                          className="flex-shrink-0 mt-4 text-gray-600 hover:text-gray-400 text-sm leading-none">×</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <button onClick={() => setShowAddClimb(true)}
                        className="text-xs text-orange-400 hover:text-orange-300 transition-colors flex items-center gap-1">
                        <span className="text-base leading-none">+</span> Add climb
                      </button>
                      <button onClick={resetClimbs} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
                        Reset to auto-detect
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>
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
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 text-center">
              <p className="text-gray-500 text-sm">Add key climbs above to generate a segment breakdown.</p>
            </div>
          )}

          <div className="h-20" />
        </div>
      </div>
    </div>
  );
}
