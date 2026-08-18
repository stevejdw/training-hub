'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceArea,
} from 'recharts';
import EnlargeableChart from '@/components/EnlargeableChart';
import type { EventGoal, EventClimb, CachedRoute, PacingStrategy } from '@/lib/profile';
import { detectClimbs, estimateTime, fmtTime, mergeStarredIntoSegments } from '@/lib/pacing';

interface Props {
  event:          EventGoal;
  riderWeightKg:  number;
  onSave:         (updated: EventGoal) => void;
  onClose:        () => void;
}

const DEFAULT_FLAT_WATTS    = 260;
const DEFAULT_DESCENT_WATTS = 120;
const DEFAULT_BIKE_KG       = 8;

export default function EventPacingModal({ event, riderWeightKg, onSave, onClose }: Props) {
  const [routeInput,  setRouteInput]  = useState(event.strava_route_id ?? '');
  const [route,       setRoute]       = useState<CachedRoute | null>(event.route ?? null);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [routeError,  setRouteError]  = useState<string | null>(null);

  // Pacing settings
  const ps = event.pacing_strategy;
  const [flatWatts,     setFlatWatts]     = useState(ps?.flat_watts    ?? DEFAULT_FLAT_WATTS);
  const [descentWatts,  setDescentWatts]  = useState(ps?.descent_watts ?? DEFAULT_DESCENT_WATTS);
  const [bikeKg,        setBikeKg]        = useState(ps?.bike_weight_kg ?? DEFAULT_BIKE_KG);
  const [climbs,        setClimbs]        = useState<EventClimb[]>(ps?.climbs ?? []);
  const [autoDetected,  setAutoDetected]  = useState(false);

  // Run climb auto-detection when route first loads (and no existing climbs)
  // Merge with starred segments from the route for better segment naming
  useEffect(() => {
    if (!route || autoDetected) return;
    if (climbs.length > 0) { setAutoDetected(true); return; }

    const detected = detectClimbs(route.stream_distance_km, route.stream_altitude_m);
    const baseClimbs = detected.map((c, i) => ({
      start_km: c.start_km, end_km: c.end_km, name: `Climb ${i + 1}`, target_watts: defaultWatts,
    }));

    // Merge with starred segments
    const defaultWatts = Math.round(flatWatts * 0.9);
    (async () => {
      try {
        const res = await fetch(`/api/events/${event.id}/starred-segments`);
        const data = await res.json() as { starred: Array<{ id: number; name: string; start_km: number; end_km: number; start_dist_m: number; end_dist_m: number; distance_m: number; avg_grade: number }> };
        if (data.starred?.length) {
          const merged = mergeStarredIntoSegments(baseClimbs, data.starred, route.distance_m / 1000);
          // Compute elevation stats for each climb
          const withStats = merged.map(c => {
            const dSlice: number[] = [];
            const aSlice: number[] = [];
            for (let idx = 0; idx < route.stream_distance_km.length; idx++) {
              const d = route.stream_distance_km[idx];
              if (d < c.start_km || d > c.end_km) continue;
              dSlice.push(d);
              aSlice.push(route.stream_altitude_m[idx]);
            }
            const dist    = c.end_km - c.start_km;
            const netGain = aSlice.length > 1 ? aSlice[aSlice.length - 1] - aSlice[0] : 0;
            const avgGrad = dist > 0 ? Math.round((netGain / (dist * 1000)) * 1000) / 10 : 0;
            return {
              name: c.name,
              start_km: Math.round(c.start_km * 10) / 10,
              end_km: Math.round(c.end_km * 10) / 10,
              distance_km: Math.round(dist * 10) / 10,
              elevation_gain: Math.round(netGain),
              avg_gradient: avgGrad,
              target_watts: defaultWatts,
            } satisfies EventClimb;
          });
          setClimbs(withStats);
        } else {
          setClimbs(baseClimbs.map((c, i) => ({
            ...detected[i],
            name: c.name,
            target_watts: defaultWatts,
          })));
        }
      } catch {
        setClimbs(baseClimbs.map((c, i) => ({
          ...detected[i],
          name: c.name,
          target_watts: defaultWatts,
        })));
      }
      setAutoDetected(true);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  // Estimated time (recalculate whenever inputs change)
  const estMin = (route && route.stream_distance_km.length > 1)
    ? estimateTime({
        stream_distance_km: route.stream_distance_km,
        stream_altitude_m:  route.stream_altitude_m,
        stream_latlng:      route.stream_latlng,
        flat_watts:         flatWatts,
        descent_watts:      descentWatts,
        climbs,
        rider_weight_kg:    riderWeightKg || 75,
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
      setAutoDetected(false); // trigger re-detection
      setClimbs([]);
    } finally {
      setLoadingRoute(false);
    }
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
      name:           `Climb ${prev.length + 1}`,
      start_km:       Math.round(lastEnd + 1),
      end_km:         Math.min(Math.round(lastEnd + 5), totalKm),
      distance_km:    4,
      elevation_gain: 200,
      avg_gradient:   5,
      target_watts:   Math.round(flatWatts * 0.9),
    }]);
  }

  const handleSave = useCallback(() => {
    const strategy: PacingStrategy = {
      flat_watts:     flatWatts,
      descent_watts:  descentWatts,
      bike_weight_kg: bikeKg,
      climbs,
      est_time_min:   estMin ?? 0,
    };
    onSave({
      ...event,
      strava_route_id: route?.id ?? event.strava_route_id,
      route:           route,
      pacing_strategy: strategy,
    });
  }, [event, route, flatWatts, descentWatts, bikeKg, climbs, estMin, onSave]);

  // Chart data
  const chartData = route
    ? route.stream_distance_km.map((d, i) => ({
        km:  d,
        alt: route.stream_altitude_m[i],
      }))
    : [];

  const totalKm  = route ? Math.round(route.distance_m / 100) / 10 : 0;
  const totalGain = route ? Math.round(route.elevation_gain) : 0;

  const inputCls = 'bg-raised border border-line-strong rounded-lg px-3 py-2 text-sm text-ink placeholder-ink-5 focus:outline-none focus:border-accent transition-colors';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-page">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-line">
        <div>
          <h2 className="text-base font-semibold text-ink">Pacing Strategy</h2>
          <p className="text-xs text-ink-4">{event.name}</p>
        </div>
        <div className="flex items-center gap-2">
          {estMin && (
            <span className="text-sm font-semibold text-accent-hi">{fmtTime(estMin)}</span>
          )}
          <button
            onClick={handleSave}
            className="px-4 py-1.5 bg-accent hover:bg-accent-hi text-ink text-sm font-medium rounded-lg transition-colors"
          >
            Save
          </button>
          <button onClick={onClose} className="text-ink-3 hover:text-ink transition-colors px-2 py-1 text-sm">
            ✕
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto scroll-touch">
        <div className="max-w-2xl mx-auto px-4 py-4 space-y-5">

          {/* Route input */}
          <div className="bg-surface rounded-xl p-4 space-y-3 border border-line">
            <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wider">Strava Route</h3>
            <div className="flex gap-2">
              <input
                className={inputCls + ' flex-1'}
                placeholder="Route URL or ID — e.g. https://www.strava.com/routes/12345678"
                value={routeInput}
                onChange={e => setRouteInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && loadRoute()}
              />
              <button
                onClick={loadRoute}
                disabled={loadingRoute}
                className="flex-shrink-0 px-4 py-2 bg-accent hover:bg-accent-hi disabled:opacity-50 text-ink text-sm font-medium rounded-lg transition-colors"
              >
                {loadingRoute ? '…' : 'Load'}
              </button>
            </div>
            {routeError && <p className="text-red-400 text-xs">{routeError}</p>}

            {route && (
              <div className="flex items-center gap-4 pt-1">
                <span className="text-sm font-medium text-ink truncate">{route.name}</span>
                <span className="flex-shrink-0 text-xs text-ink-3">{totalKm} km</span>
                <span className="flex-shrink-0 text-xs text-ink-3">{totalGain} m gain</span>
              </div>
            )}
          </div>

          {/* Elevation profile */}
          {route && chartData.length > 0 && (
            <div className="bg-surface rounded-xl p-4 border border-line">
              <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-3">Elevation Profile</h3>
              <EnlargeableChart title="Elevation Profile">
                {(fs) => (
              <ResponsiveContainer width="100%" height={fs ? '100%' : 160}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#f97316" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                  <XAxis
                    dataKey="km"
                    tick={{ fill: '#6b7280', fontSize: 10 }}
                    axisLine={false} tickLine={false}
                    tickFormatter={v => `${v}km`}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: '#6b7280', fontSize: 10 }}
                    axisLine={false} tickLine={false}
                    width={36}
                    tickFormatter={v => `${v}m`}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="bg-surface border border-line-strong rounded-lg px-2 py-1 text-xs">
                          <p className="text-ink-3">{payload[0].payload.km} km</p>
                          <p className="text-ink font-semibold">{payload[0].value} m</p>
                        </div>
                      );
                    }}
                  />
                  {/* Shade each climb on the profile */}
                  {climbs.map((c, i) => (
                    <ReferenceArea
                      key={i}
                      x1={c.start_km} x2={c.end_km}
                      fill="#ef4444" fillOpacity={0.12}
                      stroke="#ef4444" strokeOpacity={0.3} strokeWidth={1}
                    />
                  ))}
                  <Area
                    type="monotone" dataKey="alt"
                    stroke="#f97316" strokeWidth={2}
                    fill="url(#elevGrad)"
                    dot={false} activeDot={{ r: 3 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
                )}
              </EnlargeableChart>
            </div>
          )}

          {/* Climbs */}
          {route && (
            <div className="bg-surface rounded-xl p-4 space-y-3 border border-line">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wider">Key Climbs</h3>
                <button onClick={addClimb} className="text-sm text-accent-hi hover:text-accent-hi transition-colors">
                  + Add climb
                </button>
              </div>

              {climbs.length === 0 && (
                <p className="text-xs text-ink-5 py-1">No climbs detected — add manually or load a route with elevation data.</p>
              )}

              <div className="space-y-3">
                {climbs.map((c, i) => (
                  <div key={i} className="border border-line rounded-xl p-3 space-y-2">
                    {/* Climb header */}
                    <div className="flex items-center gap-2">
                      <input
                        value={c.name}
                        onChange={e => updateClimb(i, { name: e.target.value })}
                        className="flex-1 bg-transparent text-sm font-semibold text-ink focus:outline-none border-b border-transparent focus:border-line-hover"
                        placeholder="Climb name"
                      />
                      <span className="text-micro text-ink-4 flex-shrink-0">
                        {c.distance_km} km · {c.elevation_gain} m · {c.avg_gradient}%
                      </span>
                      <button onClick={() => removeClimb(i)} className="text-ink-5 hover:text-red-400 transition-colors text-xs flex-shrink-0">✕</button>
                    </div>

                    {/* Position + watts */}
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <div className="text-micro text-ink-5 mb-1">Start (km)</div>
                        <input
                          type="number"
                          value={c.start_km}
                          onChange={e => updateClimb(i, { start_km: Number(e.target.value) })}
                          className={inputCls + ' text-xs py-1'}
                          step={0.1} min={0} max={totalKm}
                        />
                      </div>
                      <div>
                        <div className="text-micro text-ink-5 mb-1">End (km)</div>
                        <input
                          type="number"
                          value={c.end_km}
                          onChange={e => updateClimb(i, { end_km: Number(e.target.value) })}
                          className={inputCls + ' text-xs py-1'}
                          step={0.1} min={0} max={totalKm}
                        />
                      </div>
                      <div>
                        <div className="text-micro text-ink-5 mb-1">Target watts</div>
                        <input
                          type="number"
                          value={c.target_watts}
                          onChange={e => updateClimb(i, { target_watts: Number(e.target.value) })}
                          className={inputCls + ' text-xs py-1'}
                          step={5} min={50} max={600}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Power settings */}
          <div className="bg-surface rounded-xl p-4 space-y-4 border border-line">
            <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wider">Power Settings</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-micro text-ink-4 uppercase tracking-wider mb-1 block">Flat / Rolling (W)</label>
                <input
                  type="number"
                  value={flatWatts}
                  onChange={e => setFlatWatts(Number(e.target.value))}
                  className={inputCls}
                  step={5} min={50} max={600}
                />
              </div>
              <div>
                <label className="text-micro text-ink-4 uppercase tracking-wider mb-1 block">Descent (W)</label>
                <input
                  type="number"
                  value={descentWatts}
                  onChange={e => setDescentWatts(Number(e.target.value))}
                  className={inputCls}
                  step={5} min={0} max={400}
                />
              </div>
              <div>
                <label className="text-micro text-ink-4 uppercase tracking-wider mb-1 block">Bike weight (kg)</label>
                <input
                  type="number"
                  value={bikeKg}
                  onChange={e => setBikeKg(Number(e.target.value))}
                  className={inputCls}
                  step={0.5} min={5} max={20}
                />
              </div>
            </div>
            <p className="text-micro text-ink-5">
              Rider weight: {riderWeightKg ? `${riderWeightKg} kg` : 'not set — add in Profile tab'} · Total system: {(riderWeightKg || 75) + bikeKg} kg
            </p>
          </div>

          {/* Estimated time breakdown */}
          {route && estMin && (
            <div className="bg-surface rounded-xl p-4 space-y-3 border border-line">
              <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wider">Estimated Time</h3>

              {/* Big number */}
              <div className="flex items-end gap-2">
                <span className="text-4xl font-bold text-ink tabular-nums">{fmtTime(estMin)}</span>
                <span className="text-sm text-ink-4 pb-1">h:mm</span>
              </div>

              {/* Stats row */}
              <div className="flex gap-4 text-xs text-ink-4">
                <span>{totalKm} km</span>
                <span>{totalGain} m gain</span>
                <span>Avg {Math.round(totalKm / (estMin / 60) * 10) / 10} km/h</span>
              </div>

              {/* Climb breakdown */}
              {climbs.length > 0 && (
                <div className="border-t border-line pt-3 space-y-1.5">
                  <p className="text-micro text-ink-5 uppercase tracking-wider mb-2">Climb estimates</p>
                  {climbs.map((c, i) => {
                    if (!route) return null;
                    const dSlice: number[] = [];
                    const aSlice: number[] = [];
                    const lSlice: [number, number][] = [];
                    for (let idx = 0; idx < route.stream_distance_km.length; idx++) {
                      const d = route.stream_distance_km[idx];
                      if (d < c.start_km || d > c.end_km) continue;
                      dSlice.push(d);
                      aSlice.push(route.stream_altitude_m[idx]);
                      if (route.stream_latlng?.[idx]) lSlice.push(route.stream_latlng[idx]);
                    }
                    const climbMin = estimateTime({
                      stream_distance_km: dSlice,
                      stream_altitude_m:  aSlice,
                      stream_latlng:      lSlice.length === dSlice.length ? lSlice : undefined,
                      flat_watts:      c.target_watts,
                      descent_watts:   c.target_watts,
                      climbs:          [],
                      rider_weight_kg: riderWeightKg || 75,
                      bike_weight_kg:  bikeKg,
                    });
                    return (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-ink-3">{c.name}</span>
                        <span className="text-ink-4 tabular-nums">
                          {c.distance_km} km · {c.elevation_gain} m · {c.target_watts}W → <span className="text-ink font-medium">{fmtTime(climbMin)}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
