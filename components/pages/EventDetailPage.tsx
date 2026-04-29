'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceArea,
} from 'recharts';
import type { EventGoal, EventClimb, CachedRoute, PacingStrategy } from '@/lib/profile';
import { detectClimbs, estimateTime, fmtTime } from '@/lib/pacing';
import PageHeader from '@/components/PageHeader';
import { iconFor } from '@/components/nav-items';
import { useProfileEdit, inputCls } from '@/lib/use-profile-edit';
import Link from 'next/link';

const DEFAULT_FLAT_WATTS    = 260;
const DEFAULT_DESCENT_WATTS = 120;
const DEFAULT_BIKE_KG       = 8;

function daysToGo(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d     = new Date(dateStr + 'T00:00:00'); d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

interface Props { eventId: string }

export default function EventDetailPage({ eventId }: Props) {
  const router = useRouter();
  const { profile, setProfile, save, saving, saved } = useProfileEdit();

  // Find the event
  const eventIdx = profile?.events.findIndex(e => (e.id ?? '') === eventId) ?? -1;
  const event    = eventIdx >= 0 ? profile!.events[eventIdx] : null;

  // Local edits to the event fields
  const [name,     setName]     = useState('');
  const [date,     setDate]     = useState('');
  const [location, setLocation] = useState('');
  const [goal,     setGoal]     = useState('');

  // Route + pacing state
  const [routeInput,    setRouteInput]    = useState('');
  const [route,         setRoute]         = useState<CachedRoute | null>(null);
  const [loadingRoute,  setLoadingRoute]  = useState(false);
  const [routeError,    setRouteError]    = useState<string | null>(null);
  const [flatWatts,     setFlatWatts]     = useState(DEFAULT_FLAT_WATTS);
  const [descentWatts,  setDescentWatts]  = useState(DEFAULT_DESCENT_WATTS);
  const [bikeKg,        setBikeKg]        = useState(DEFAULT_BIKE_KG);
  const [climbs,        setClimbs]        = useState<EventClimb[]>([]);
  const [autoDetected,  setAutoDetected]  = useState(false);

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
      setBikeKg(event.pacing_strategy.bike_weight_kg ?? DEFAULT_BIKE_KG);
      setClimbs(event.pacing_strategy.climbs ?? []);
      setAutoDetected(true);
    }
  // run once when event loads
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
        target_watts: Math.round(flatWatts * 0.9),
      })));
    }
    setAutoDetected(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  const riderWeightKg = profile?.weight_kg ?? 75;

  const estMin = route && route.stream_distance_km.length > 1
    ? estimateTime({
        stream_distance_km: route.stream_distance_km,
        stream_altitude_m:  route.stream_altitude_m,
        flat_watts:         flatWatts,
        descent_watts:      descentWatts,
        climbs,
        rider_weight_kg:    riderWeightKg,
        bike_weight_kg:     bikeKg,
      })
    : null;

  async function loadRoute() {
    const raw   = routeInput.trim();
    const match = raw.match(/\d{5,}/);
    if (!match) { setRouteError('Enter a Strava route URL or ID (e.g. 12345678)'); return; }
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
      ? { flat_watts: flatWatts, descent_watts: descentWatts, bike_weight_kg: bikeKg, climbs, est_time_min: estMin ?? 0 }
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
  }

  function deleteEvent() {
    if (!profile || !confirm('Delete this event?')) return;
    const events = profile.events.filter(e => (e.id ?? '') !== eventId);
    const merged = { ...profile, events };
    setProfile(merged);
    save(merged);
    router.push('/events');
  }

  function updateClimb(i: number, patch: Partial<EventClimb>) {
    setClimbs(prev => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c));
  }
  function removeClimb(i: number) {
    setClimbs(prev => prev.filter((_, idx) => idx !== i));
  }
  function addClimb() {
    const lastEnd = climbs[climbs.length - 1]?.end_km ?? 0;
    const totalKm = route ? route.distance_m / 1000 : lastEnd + 10;
    setClimbs(prev => [...prev, {
      name: `Climb ${prev.length + 1}`,
      start_km:       Math.round(lastEnd + 1),
      end_km:         Math.min(Math.round(lastEnd + 5), totalKm),
      distance_km:    4,
      elevation_gain: 200,
      avg_gradient:   5,
      target_watts:   Math.round(flatWatts * 0.9),
    }]);
  }

  const totalKm   = route ? Math.round(route.distance_m / 100) / 10 : 0;
  const totalGain = route ? Math.round(route.elevation_gain) : 0;

  const chartData = route
    ? route.stream_distance_km.map((d, i) => ({ km: d, alt: route.stream_altitude_m[i] }))
    : [];

  const days = date ? daysToGo(date) : null;
  const daysLabel = days === null ? null
    : days === 0   ? 'Today!'
    : days === 1   ? 'Tomorrow'
    : days > 0     ? `${days} days to go`
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

  const backBtn = (
    <Link href="/events" className="text-sm text-gray-500 hover:text-orange-400 transition-colors">
      ← Events
    </Link>
  );

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

      {/* Back link below header */}
      <div className="flex-shrink-0 px-4 md:px-8 py-2 border-b border-gray-800/60 flex items-center justify-between">
        {backBtn}
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
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className={inputCls}
                placeholder="e.g. Peaks Challenge"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Location</label>
                <input
                  type="text"
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  className={inputCls}
                  placeholder="e.g. Falls Creek, VIC"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Goal</label>
              <input
                type="text"
                value={goal}
                onChange={e => setGoal(e.target.value)}
                className={inputCls}
                placeholder="e.g. Sub 8:30, finish strong, top 10"
              />
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
                placeholder="Route URL or ID — e.g. https://www.strava.com/routes/12345678"
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
                      return (
                        <div className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-xs">
                          <p className="text-gray-400">{payload[0].payload.km} km</p>
                          <p className="text-white font-semibold">{payload[0].value} m</p>
                        </div>
                      );
                    }}
                  />
                  {climbs.map((c, i) => (
                    <ReferenceArea key={i} x1={c.start_km} x2={c.end_km} fill="#ef4444" fillOpacity={0.12} stroke="#ef4444" strokeOpacity={0.3} strokeWidth={1} />
                  ))}
                  <Area type="monotone" dataKey="alt" stroke="#f97316" strokeWidth={2} fill="url(#elevGradDetail)" dot={false} activeDot={{ r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </section>
          )}

          {/* ── Climbs ────────────────────────────────────────────── */}
          {route && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Key Climbs</h2>
                <button onClick={addClimb} className="text-sm text-orange-400 hover:text-orange-300 transition-colors">
                  + Add climb
                </button>
              </div>

              {climbs.length === 0 && (
                <p className="text-xs text-gray-600 py-1">No climbs detected — add manually or ensure the route has elevation data.</p>
              )}

              <div className="space-y-3">
                {climbs.map((c, i) => (
                  <div key={i} className="border border-gray-800 rounded-xl p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        value={c.name}
                        onChange={e => updateClimb(i, { name: e.target.value })}
                        className="flex-1 bg-transparent text-sm font-semibold text-white focus:outline-none border-b border-transparent focus:border-gray-600"
                        placeholder="Climb name"
                      />
                      <span className="text-[10px] text-gray-500 flex-shrink-0">
                        {c.distance_km} km · {c.elevation_gain} m · {c.avg_gradient}%
                      </span>
                      <button onClick={() => removeClimb(i)} className="text-gray-600 hover:text-red-400 transition-colors text-xs flex-shrink-0">✕</button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <div className="text-[10px] text-gray-600 mb-1">Start (km)</div>
                        <input type="number" value={c.start_km} onChange={e => updateClimb(i, { start_km: Number(e.target.value) })} className={inputCls + ' text-xs py-1'} step={0.1} min={0} max={totalKm} />
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-600 mb-1">End (km)</div>
                        <input type="number" value={c.end_km} onChange={e => updateClimb(i, { end_km: Number(e.target.value) })} className={inputCls + ' text-xs py-1'} step={0.1} min={0} max={totalKm} />
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-600 mb-1">Target (W)</div>
                        <input type="number" value={c.target_watts} onChange={e => updateClimb(i, { target_watts: Number(e.target.value) })} className={inputCls + ' text-xs py-1'} step={5} min={50} max={600} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Pacing strategy ───────────────────────────────────── */}
          <section className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-4">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Pacing Strategy</h2>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 block">Flat / Rolling (W)</label>
                <input type="number" value={flatWatts} onChange={e => setFlatWatts(Number(e.target.value))} className={inputCls} step={5} min={50} max={600} />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 block">Descent (W)</label>
                <input type="number" value={descentWatts} onChange={e => setDescentWatts(Number(e.target.value))} className={inputCls} step={5} min={0} max={400} />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 block">Bike (kg)</label>
                <input type="number" value={bikeKg} onChange={e => setBikeKg(Number(e.target.value))} className={inputCls} step={0.5} min={5} max={20} />
              </div>
            </div>
            <p className="text-[10px] text-gray-600">
              Rider: {riderWeightKg} kg · System: {riderWeightKg + bikeKg} kg
            </p>

            {/* Estimated time */}
            {route && estMin ? (
              <div className="bg-gray-800/60 rounded-xl p-4 space-y-2">
                <div className="flex items-end gap-2">
                  <span className="text-4xl font-bold text-white tabular-nums">{fmtTime(estMin)}</span>
                  <span className="text-sm text-gray-500 pb-1">estimated</span>
                </div>
                <div className="flex gap-4 text-xs text-gray-500">
                  <span>{totalKm} km</span>
                  <span>{totalGain} m gain</span>
                  <span>Avg {Math.round(totalKm / (estMin / 60) * 10) / 10} km/h</span>
                </div>

                {climbs.length > 0 && (
                  <div className="border-t border-gray-700/60 pt-3 space-y-1.5">
                    <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">Climb estimates</p>
                    {climbs.map((c, i) => {
                      if (!route) return null;
                      const climbMin = estimateTime({
                        stream_distance_km: route.stream_distance_km.filter(d => d >= c.start_km && d <= c.end_km),
                        stream_altitude_m:  route.stream_altitude_m.filter((_, idx) =>
                          route.stream_distance_km[idx] >= c.start_km && route.stream_distance_km[idx] <= c.end_km
                        ),
                        flat_watts: c.target_watts, descent_watts: c.target_watts,
                        climbs: [], rider_weight_kg: riderWeightKg, bike_weight_kg: bikeKg,
                      });
                      return (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="text-gray-400">{c.name}</span>
                          <span className="text-gray-500 tabular-nums">
                            {c.distance_km} km · {c.elevation_gain} m · {c.target_watts}W → <span className="text-white font-medium">{fmtTime(climbMin)}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-600 italic">Load a Strava course above to calculate an estimated time.</p>
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
              {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save event'}
            </button>
          </div>

          <div className="h-20" />
        </div>
      </div>
    </div>
  );
}
