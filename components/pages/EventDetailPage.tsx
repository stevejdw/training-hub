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

// ─── Peaks Challenge: 8 known climbs (start/end km) ──────────────────────────
// Elevation stats are derived live from the loaded GPS stream.
// Endpoints for climbs 1/6/7 are best estimates — user can fine-tune with the
// delete/add UI, but these match the actual Peaks Challenge Falls Creek route.
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

/** Build an EventClimb from known km bounds, deriving elevation from the GPS stream. */
function climbFromBounds(
  route: CachedRoute,
  name: string,
  startKm: number,
  endKm: number,
  targetWatts: number,
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
    name,
    start_km:       Math.round(startKm * 10) / 10,
    end_km:         Math.round(endKm   * 10) / 10,
    distance_km:    dist,
    elevation_gain: Math.round(net),
    avg_gradient:   avgGrad,
    target_watts:   targetWatts,
  };
}

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

// ─── Course map (Leaflet) ─────────────────────────────────────────────────────
interface CourseMapProps {
  latlng:        [number, number][];
  climbs:        EventClimb[];
  distKm:        number[];
  selectedClimb: number | null;
}

function CourseMap({ latlng, climbs, distKm, selectedClimb }: CourseMapProps) {
  const containerRef  = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapStateRef   = useRef<{ L: any; map: any; climbGroup: any } | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Initialise map once when latlng is available
  useEffect(() => {
    if (!containerRef.current || latlng.length < 2) return;
    if (mapStateRef.current) return; // already initialised

    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (cancelled || !containerRef.current || mapStateRef.current) return;

      const map = L.map(containerRef.current, {
        zoomControl: false, attributionControl: false,
        dragging: false, scrollWheelZoom: false,
        doubleClickZoom: false, touchZoom: false,
        keyboard: false, boxZoom: false,
      });

      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
      }).addTo(map);

      // Route line
      const routeLine = L.polyline(latlng, { color: '#1d4ed8', weight: 3, opacity: 0.8 });
      routeLine.addTo(map);
      map.fitBounds(routeLine.getBounds(), { padding: [14, 14] });

      // Start / finish markers
      const dotIcon = (color: string) => L.divIcon({
        className: '',
        html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>`,
        iconSize: [12, 12], iconAnchor: [6, 6],
      });
      L.marker(latlng[0],              { icon: dotIcon('#22c55e') }).addTo(map);
      L.marker(latlng[latlng.length-1],{ icon: dotIcon('#dc2626') }).addTo(map);

      const climbGroup = L.layerGroup().addTo(map);
      mapStateRef.current = { L, map, climbGroup };
      setMapReady(true);
    })();

    return () => {
      cancelled = true;
      if (mapStateRef.current) {
        mapStateRef.current.map.remove();
        mapStateRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latlng]);

  // Redraw climb overlays whenever climbs or selection changes
  useEffect(() => {
    if (!mapReady || !mapStateRef.current) return;
    const { L, climbGroup } = mapStateRef.current;
    climbGroup.clearLayers();

    const anySel = selectedClimb !== null;
    for (let ci = 0; ci < climbs.length; ci++) {
      const c = climbs[ci];
      const pts: [number, number][] = [];
      for (let i = 0; i < distKm.length && i < latlng.length; i++) {
        if (distKm[i] >= c.start_km - 0.2 && distKm[i] <= c.end_km + 0.2) pts.push(latlng[i]);
      }
      if (pts.length < 2) continue;

      const isSel = selectedClimb === ci;
      if (isSel) {
        // Glow halo
        L.polyline(pts, { color: '#f97316', weight: 10, opacity: 0.22 }).addTo(climbGroup);
        // Main highlight
        L.polyline(pts, { color: '#f97316', weight: 4.5, opacity: 1 }).addTo(climbGroup);
      } else {
        L.polyline(pts, {
          color:   '#ef4444',
          weight:  anySel ? 2.5 : 3.5,
          opacity: anySel ? 0.3  : 0.85,
        }).addTo(climbGroup);
      }
    }
  }, [mapReady, climbs, distKm, latlng, selectedClimb]);

  if (!latlng.length) return null;
  return <div ref={containerRef} className="w-full h-52 rounded-xl overflow-hidden" />;
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

  // ── Key Climbs edit mode ──
  const [editingClimbs, setEditingClimbs] = useState(false);
  const [climbDrafts,   setClimbDrafts]   = useState<{ start_km: string; end_km: string }[]>([]);
  const [showAddClimb,  setShowAddClimb]  = useState(false);
  const [addStart,      setAddStart]      = useState('');
  const [addEnd,        setAddEnd]        = useState('');

  // ── Speed targets ──
  const [descentSpeedKmh, setDescentSpeedKmh] = useState<number | undefined>(undefined);
  const [flatSpeedKmh,    setFlatSpeedKmh]    = useState<number | undefined>(undefined);

  const riderKg = profile?.weight_kg      ?? 75;
  const bikeKg  = profile?.bike_weight_kg ?? 8;

  // Track whether we have unsaved edits in edit mode
  const savedEventRef  = useRef(event);
  const elevationRef   = useRef<HTMLElement>(null);

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
      setDescentSpeedKmh(event.pacing_strategy.descent_speed_kmh ?? undefined);
      setFlatSpeedKmh(event.pacing_strategy.flat_speed_kmh ?? undefined);
      setAutoDetected(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventIdx >= 0]);

  // ── Auto-detect climbs (or seed known Peaks Challenge climbs) ──
  useEffect(() => {
    if (!route || autoDetected) return;
    if (climbs.length > 0) { setAutoDetected(true); return; }
    const defaultWatts = Math.round(flatWatts * 0.88);
    if (name.toLowerCase().includes('peaks challenge')) {
      setClimbs(PEAKS_CHALLENGE_BOUNDS.map(b =>
        climbFromBounds(route, b.name, b.start_km, b.end_km, defaultWatts)
      ));
    } else {
      const detected = detectClimbs(route.stream_distance_km, route.stream_altitude_m);
      setClimbs(detected.map((c, i) => ({
        ...c, name: `Climb ${i + 1}`, target_watts: defaultWatts,
      })));
    }
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
      descentSpeedKmh, flatSpeedKmh,
    );
  }, [route, climbs, flatWatts, descentWatts, riderKg, bikeKg, descentSpeedKmh, flatSpeedKmh]);

  const estMin = useMemo(() => {
    if (!route) return null;
    return estimateTime({
      stream_distance_km: route.stream_distance_km,
      stream_altitude_m:  route.stream_altitude_m,
      flat_watts: flatWatts, descent_watts: descentWatts,
      flat_speed_kmh: flatSpeedKmh, descent_speed_kmh: descentSpeedKmh,
      climbs, rider_weight_kg: riderKg, bike_weight_kg: bikeKg,
    });
  }, [route, flatWatts, descentWatts, climbs, riderKg, bikeKg, descentSpeedKmh, flatSpeedKmh]);

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
      ? { flat_watts: flatWatts, flat_speed_kmh: flatSpeedKmh, descent_watts: descentWatts, descent_speed_kmh: descentSpeedKmh, bike_weight_kg: bikeKg, climbs, est_time_min: estMin ?? 0 }
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

  // ── Climb management ──
  function deleteClimb(i: number) {
    setClimbs(prev => prev.filter((_, idx) => idx !== i).map((c, idx) => ({ ...c, name: `Climb ${idx + 1}` })));
    setClimbDrafts(prev => prev.filter((_, idx) => idx !== i));
    setSelectedClimb(null);
  }

  function resetClimbs() {
    if (!route) return;
    const defaultWatts = Math.round(flatWatts * 0.88);
    if (name.toLowerCase().includes('peaks challenge')) {
      setClimbs(PEAKS_CHALLENGE_BOUNDS.map(b =>
        climbFromBounds(route, b.name, b.start_km, b.end_km, defaultWatts)
      ));
    } else {
      const detected = detectClimbs(route.stream_distance_km, route.stream_altitude_m);
      setClimbs(detected.map((c, i) => ({
        ...c, name: `Climb ${i + 1}`, target_watts: defaultWatts,
      })));
    }
    setSelectedClimb(null);
    setShowAddClimb(false);
  }

  function addCustomClimb() {
    if (!route) return;
    const s = parseFloat(addStart);
    const e = parseFloat(addEnd);
    if (isNaN(s) || isNaN(e) || e <= s) return;

    // Derive stats from route stream
    const d   = route.stream_distance_km;
    const a   = route.stream_altitude_m;
    let firstAlt: number | null = null, lastAlt = 0;
    for (let i = 0; i < d.length; i++) {
      if (d[i] < s || d[i] > e) continue;
      if (firstAlt === null) firstAlt = a[i];
      lastAlt = a[i];
    }
    const dist    = Math.round((e - s) * 10) / 10;
    const net     = firstAlt !== null ? lastAlt - firstAlt : 0;
    const avgGrad = dist > 0 ? Math.round((net / (dist * 1000)) * 1000) / 10 : 0;

    const newClimb: EventClimb = {
      name:           '',
      start_km:       Math.round(s * 10) / 10,
      end_km:         Math.round(e * 10) / 10,
      distance_km:    dist,
      elevation_gain: Math.round(net),
      avg_gradient:   avgGrad,
      target_watts:   Math.round(flatWatts * 0.88),
    };

    const next = [...climbs, newClimb].sort((a, b) => a.start_km - b.start_km).map((c, i) => ({ ...c, name: `Climb ${i + 1}` }));
    setClimbs(next);
    setClimbDrafts(next.map(c => ({ start_km: String(c.start_km), end_km: String(c.end_km) })));
    setAddStart(''); setAddEnd(''); setShowAddClimb(false);
  }

  function computeClimbStats(startKm: number, endKm: number) {
    if (!route) return { distance_km: 0, elevation_gain: 0, avg_gradient: 0 };
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

  function startClimbEdit() {
    setClimbDrafts(climbs.map(c => ({ start_km: String(c.start_km), end_km: String(c.end_km) })));
    setEditingClimbs(true);
    setSelectedClimb(null);
  }

  function applyClimbEdits() {
    const updated = climbs.map((c, i) => {
      const d = climbDrafts[i];
      if (!d) return c;
      const s = parseFloat(d.start_km), e = parseFloat(d.end_km);
      if (isNaN(s) || isNaN(e) || e <= s) return c;
      const stats = computeClimbStats(Math.round(s * 10) / 10, Math.round(e * 10) / 10);
      return { ...c, ...stats, start_km: Math.round(s * 10) / 10, end_km: Math.round(e * 10) / 10 };
    });
    setClimbs(updated);
    setEditingClimbs(false);
    setShowAddClimb(false);
    persistEventWithClimbs(updated);
  }

  function persistEventWithClimbs(newClimbs: EventClimb[]) {
    if (!profile) return;
    const strategy: PacingStrategy | null = route
      ? { flat_watts: flatWatts, flat_speed_kmh: flatSpeedKmh, descent_watts: descentWatts,
          descent_speed_kmh: descentSpeedKmh, bike_weight_kg: bikeKg, climbs: newClimbs, est_time_min: estMin ?? 0 }
      : event?.pacing_strategy ?? null;
    const updated = { id: eventId, name, date, location, goal, strava_route_id: route?.id ?? event?.strava_route_id, route: route ?? event?.route ?? null, pacing_strategy: strategy };
    const events  = profile.events.map(e => (e.id ?? '') === eventId ? updated : e);
    const merged  = { ...profile, events };
    setProfile(merged); save(merged);
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
  return (
    <div className="h-full flex flex-col">
      <PageHeader icon={iconFor('events')} title={name || 'Event'} />

      <div className="flex-shrink-0 px-4 md:px-8 py-2 border-b border-gray-800/60 flex items-center justify-between">
        <Link href="/events" className="text-sm text-gray-500 hover:text-orange-400 transition-colors">← Events</Link>
        {daysLabel && <span className={`text-xs font-semibold uppercase tracking-wider ${daysColor}`}>{daysLabel}</span>}
      </div>

      <div className="flex-1 overflow-y-auto scroll-touch">
        <div className="max-w-2xl mx-auto px-4 py-4 md:px-8 md:py-6 space-y-4">

          {/* ── Event summary ─────────────────────────────────── */}
          <section className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-2">
            {/* Name row + Edit button */}
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-xl font-bold text-white leading-tight flex-1">{name || 'Unnamed Event'}</h2>
              <button
                onClick={() => setEditing(true)}
                className="flex-shrink-0 text-xs text-gray-400 hover:text-orange-400 border border-gray-700 hover:border-orange-500/50 rounded-lg px-2.5 py-1.5 transition-colors mt-0.5"
              >
                Edit
              </button>
            </div>
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
          {route && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              {route.stream_latlng && route.stream_latlng.length > 1 ? (
                <>
                  <CourseMap
                    latlng={route.stream_latlng}
                    climbs={climbs}
                    distKm={route.stream_distance_km}
                    selectedClimb={selectedClimb}
                  />
                  <p className="px-3 pb-2 pt-1 text-[10px] text-gray-500 flex items-center gap-3">
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-green-500" />Start</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-red-500" />Finish</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-1.5 rounded-sm bg-red-500 opacity-80" />Climbs</span>
                    {selectedClimb !== null && (
                      <span className="flex items-center gap-1"><span className="inline-block w-3 h-1.5 rounded-sm bg-orange-500" />{climbs[selectedClimb]?.name}</span>
                    )}
                  </p>
                </>
              ) : (
                <div className="flex items-center justify-between px-4 py-3">
                  <p className="text-xs text-gray-600">Map unavailable — remove &amp; re-load course in Edit to enable</p>
                  <button onClick={() => setEditing(true)} className="text-xs text-orange-400 hover:text-orange-300 transition-colors flex-shrink-0 ml-3">
                    Edit →
                  </button>
                </div>
              )}
            </section>
          )}

          {/* ── Elevation profile ─────────────────────────────── */}
          {route && chartData.length > 0 && (
            <section ref={elevationRef} className="bg-[#f5f7fa] border border-gray-200 rounded-2xl p-4 space-y-2">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Elevation Profile</h2>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#1d4ed8" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#1d4ed8" stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" vertical={false} />
                  <XAxis dataKey="km" type="number" domain={['dataMin','dataMax']} tick={{ fill:'#6b7280', fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={v=>`${v}km`} interval="preserveStartEnd" />
                  <YAxis tick={{ fill:'#6b7280', fontSize:10 }} axisLine={false} tickLine={false} width={36} tickFormatter={v=>`${v}m`} />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const km = payload[0].payload.km as number;
                    const inC = climbs.find(c => km >= c.start_km && km <= c.end_km);
                    return (
                      <div className="bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs shadow-sm">
                        <p className="text-gray-500">{km} km{inC ? ` · ${inC.name}` : ''}</p>
                        <p className="text-gray-900 font-semibold">{payload[0].value} m</p>
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
                        fillOpacity={sel ? 0.25 : anySel ? 0 : 0.1}
                        stroke={sel ? '#f97316' : '#ef4444'}
                        strokeOpacity={sel ? 0.9 : anySel ? 0 : 0.25}
                        strokeWidth={sel ? 2 : 1}
                      />
                    );
                  })}
                  <Area type="monotone" dataKey="alt" stroke="#1d4ed8" strokeWidth={2} fill="url(#elevGrad)" dot={false} activeDot={{ r: 3, fill: '#1d4ed8' }} />
                </AreaChart>
              </ResponsiveContainer>
              {selectedClimb !== null && climbs[selectedClimb] && (
                <p className="text-xs text-orange-500 text-center font-medium">
                  ▲ {climbs[selectedClimb].name} — {climbs[selectedClimb].start_km}–{climbs[selectedClimb].end_km} km
                </p>
              )}
            </section>
          )}

          {/* ── Key Climbs tile (expandable) ─────────────────── */}
          {route && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              {/* Header row */}
              <div className="flex items-center justify-between p-4">
                <button
                  onClick={() => !editingClimbs && setClimbsOpen(o => !o)}
                  className="flex-1 text-left"
                >
                  <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Key Climbs</h2>
                  <p className="text-sm text-gray-300 mt-0.5">
                    {climbs.length > 0
                      ? `${climbs.length} climb${climbs.length !== 1 ? 's' : ''} · ${totalClimbAscent.toLocaleString()} m total ascent`
                      : 'No climbs detected'}
                  </p>
                </button>
                {editingClimbs ? (
                  <button
                    onClick={applyClimbEdits}
                    className="flex-shrink-0 text-xs text-orange-400 hover:text-orange-300 border border-orange-500/30 hover:border-orange-500/60 rounded-lg px-3 py-1.5 transition-colors ml-3"
                  >
                    Done
                  </button>
                ) : (
                  <button
                    onClick={() => { setClimbsOpen(true); startClimbEdit(); }}
                    className="flex-shrink-0 text-xs text-gray-500 hover:text-orange-400 border border-gray-700 hover:border-orange-500/40 rounded-lg px-3 py-1.5 transition-colors ml-3"
                  >
                    Edit
                  </button>
                )}
              </div>

              {/* Climb list */}
              {(climbsOpen || editingClimbs) && climbs.length > 0 && (
                <div className="border-t border-gray-800 divide-y divide-gray-800/60">
                  {climbs.map((c, i) => {
                    const seg    = segments.find(s => s.type === 'climb' && s.climb_idx === i);
                    const estStr = seg ? fmtTime(seg.est_time_min) : null;
                    const isSel  = selectedClimb === i;
                    if (editingClimbs) {
                      const draft = climbDrafts[i] ?? { start_km: String(c.start_km), end_km: String(c.end_km) };
                      return (
                        <div key={i} className="flex items-center gap-2 px-4 py-2.5">
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-gray-800 flex items-center justify-center text-[10px] font-bold text-gray-400">
                            {i + 1}
                          </span>
                          <p className="text-xs font-medium text-white truncate flex-1 min-w-0">{c.name}</p>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <div className="flex flex-col items-end">
                              <label className="text-[9px] text-gray-600 uppercase tracking-wider mb-0.5">Start km</label>
                              <input
                                type="number"
                                value={draft.start_km}
                                step="0.1" min="0"
                                onChange={e => setClimbDrafts(prev => prev.map((d, idx) => idx === i ? { ...d, start_km: e.target.value } : d))}
                                className="w-16 bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-white text-right focus:outline-none focus:border-orange-500 tabular-nums"
                              />
                            </div>
                            <div className="flex flex-col items-end">
                              <label className="text-[9px] text-gray-600 uppercase tracking-wider mb-0.5">End km</label>
                              <input
                                type="number"
                                value={draft.end_km}
                                step="0.1" min="0"
                                onChange={e => setClimbDrafts(prev => prev.map((d, idx) => idx === i ? { ...d, end_km: e.target.value } : d))}
                                className="w-16 bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-white text-right focus:outline-none focus:border-orange-500 tabular-nums"
                              />
                            </div>
                          </div>
                          <button
                            onClick={() => deleteClimb(i)}
                            className="flex-shrink-0 text-gray-600 hover:text-red-400 transition-colors text-lg leading-none ml-1"
                            title="Remove climb"
                          >×</button>
                        </div>
                      );
                    }
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          setSelectedClimb(isSel ? null : i);
                          if (!isSel) elevationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800/40 transition-colors group text-left ${isSel ? 'bg-orange-500/5' : ''}`}
                      >
                        <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${isSel ? 'bg-orange-500/30 text-orange-400' : 'bg-gray-800 text-gray-400 group-hover:bg-orange-500/20 group-hover:text-orange-400'}`}>
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-semibold truncate ${isSel ? 'text-orange-400' : 'text-white'}`}>{c.name}</p>
                          <div className="flex items-center gap-3 mt-0.5 text-[11px] text-gray-500">
                            <span>{c.start_km}–{c.end_km} km</span>
                            <span>{c.distance_km} km</span>
                            <span className="text-orange-400">+{c.elevation_gain} m</span>
                            <span>{c.avg_gradient}% avg</span>
                          </div>
                        </div>
                        {estStr && (
                          <span className="flex-shrink-0 text-sm font-bold text-white tabular-nums">{estStr}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Edit mode footer: add + refresh */}
              {editingClimbs && (
                <div className="border-t border-gray-800/60 p-3">
                  {showAddClimb ? (
                    <div className="space-y-2">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider">Add climb</p>
                      <div className="flex items-end gap-2">
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
                          className="flex-shrink-0 px-3 py-1.5 bg-orange-500 hover:bg-orange-400 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors">Add</button>
                        <button onClick={() => { setShowAddClimb(false); setAddStart(''); setAddEnd(''); }}
                          className="flex-shrink-0 text-gray-600 hover:text-gray-400 text-xl leading-none pb-0.5">×</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <button onClick={() => setShowAddClimb(true)}
                        className="text-xs text-orange-400 hover:text-orange-300 transition-colors flex items-center gap-1">
                        <span className="text-base leading-none">+</span> Add climb
                      </button>
                      <button onClick={() => { resetClimbs(); setClimbDrafts([]); }}
                        className="text-xs text-gray-600 hover:text-gray-400 transition-colors flex items-center gap-1">
                        ↺ Refresh
                      </button>
                    </div>
                  )}
                </div>
              )}

              {(climbsOpen || editingClimbs) && climbs.length === 0 && !showAddClimb && (
                <div className="border-t border-gray-800 px-4 py-4 text-sm text-gray-600">
                  {editingClimbs ? 'Add climbs below, or use Refresh to auto-detect.' : 'Load a Strava course to auto-detect climbs.'}
                </div>
              )}
            </section>
          )}

          {/* ── Pacing Strategy tile (clickable) ─────────────── */}
          {route && (
            <Link
              href={`/events/${eventId}/pacing`}
              className="block bg-gray-900 border border-gray-800 rounded-2xl p-4 hover:bg-gray-800/40 hover:border-gray-700 transition-colors group"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Pacing Strategy</h2>
                <svg className="w-4 h-4 text-gray-600 group-hover:text-orange-400 flex-shrink-0 transition-colors mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>

              {estMin ? (
                <>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {[
                      { label: 'Est Time',  value: fmtTime(estMin),         color: 'text-white' },
                      { label: 'Avg Power', value: `${avgWatts ?? '—'}W`,   color: 'text-orange-400' },
                      { label: 'NP',        value: `${np ?? '—'}W`,         color: 'text-yellow-400' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-gray-800/60 rounded-lg p-2 text-center">
                        <p className="text-[9px] text-gray-500 uppercase tracking-wider mb-0.5">{label}</p>
                        <p className={`text-sm font-bold tabular-nums ${color}`}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {segments.length > 0 && (() => {
                    const climbMin   = segments.filter(s => s.type === 'climb').reduce((t, s) => t + s.est_time_min, 0);
                    const descentMin = segments.filter(s => s.type === 'descent').reduce((t, s) => t + s.est_time_min, 0);
                    const flatMin    = segments.filter(s => s.type === 'flat').reduce((t, s) => t + s.est_time_min, 0);
                    return (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 border-t border-gray-800/60 pt-2">
                        {climbMin > 0   && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500/60" />Climbing {fmtTime(climbMin)}</span>}
                        {descentMin > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500/60" />Descending {fmtTime(descentMin)}</span>}
                        {flatMin > 0    && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-500/60" />Flat / Rolling {fmtTime(flatMin)}</span>}
                      </div>
                    );
                  })()}
                </>
              ) : (
                <p className="text-xs text-gray-600">Tap to set up your pacing strategy</p>
              )}
            </Link>
          )}

          <div className="h-20" />
        </div>
      </div>
    </div>
  );
}
