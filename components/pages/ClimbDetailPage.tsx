'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { useProfileEdit, inputCls } from '@/lib/use-profile-edit';
import PageHeader from '@/components/PageHeader';
import { iconFor } from '@/components/nav-items';
import { estimateTime, fmtTime, speedForPower, powerForSpeed } from '@/lib/pacing';
import Link from 'next/link';

interface Effort {
  id: number;
  name: string;
  date: string;
  moving_time: number;
  elapsed_time: number;
  distance_m: number;
  average_watts: number | null;
  average_heartrate: number | null;
  pr_rank: number | null;
  kom_rank: number | null;
  activity_id: number;
  activity_name: string;
}

function fmtSecs(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface Props { eventId: string; climbIdx: number }

export default function ClimbDetailPage({ eventId, climbIdx }: Props) {
  const router = useRouter();
  const { profile, setProfile, save, saving } = useProfileEdit();

  const event = profile?.events.find(e => (e.id ?? '') === eventId) ?? null;
  const climb = event?.pacing_strategy?.climbs?.[climbIdx] ?? null;
  const route = event?.route ?? null;

  const [targetWatts, setTargetWatts] = useState(climb?.target_watts ?? 240);
  const [speedDraft,  setSpeedDraft]  = useState('');

  useEffect(() => {
    if (climb?.target_watts) setTargetWatts(climb.target_watts);
  }, [climb?.target_watts]);

  // Slice route streams to just this climb
  const chartData = useMemo(() => {
    if (!route || !climb) return [];
    const tol = 0.15;
    const pts: { km: number; alt: number }[] = [];
    for (let i = 0; i < route.stream_distance_km.length; i++) {
      const d = route.stream_distance_km[i];
      if (d >= climb.start_km - tol && d <= climb.end_km + tol) {
        pts.push({
          km:  Math.round(Math.max(0, d - climb.start_km) * 10) / 10,
          alt: route.stream_altitude_m[i],
        });
      }
    }
    return pts;
  }, [route, climb]);

  const riderKg = profile?.weight_kg      ?? 75;
  const bikeKg  = profile?.bike_weight_kg ?? 8;
  const totalKg = riderKg + bikeKg;

  const estMin = useMemo(() => {
    if (!route || !climb || chartData.length < 2) return null;
    const sliceD = chartData.map(p => p.km + climb.start_km);
    const sliceA = chartData.map(p => p.alt);
    const tol = 0.15;
    const sliceL: [number, number][] = [];
    for (let i = 0; i < route.stream_distance_km.length; i++) {
      const d = route.stream_distance_km[i];
      if (d >= climb.start_km - tol && d <= climb.end_km + tol && route.stream_latlng?.[i]) {
        sliceL.push(route.stream_latlng[i]);
      }
    }
    return estimateTime({
      stream_distance_km: sliceD,
      stream_altitude_m:  sliceA,
      stream_latlng:      sliceL.length === sliceD.length ? sliceL : undefined,
      flat_watts:         targetWatts,
      descent_watts:      targetWatts,
      climbs:             [],
      rider_weight_kg:    riderKg,
      bike_weight_kg:     bikeKg,
    });
  }, [route, climb, chartData, targetWatts, riderKg, bikeKg]);

  // Approx avg speed for this climb
  const avgSpeedKmh = useMemo(() => {
    if (!climb || !estMin) return null;
    return Math.round((climb.distance_km / (estMin / 60)) * 10) / 10;
  }, [climb, estMin]);

  // Speed display value: draft while focused, computed otherwise
  const displaySpeed = speedDraft !== ''
    ? speedDraft
    : String(avgSpeedKmh ?? '');

  // Previous results
  const [efforts,      setEfforts]      = useState<Effort[]>([]);
  const [loadingEfforts, setLoadingEfforts] = useState(true);

  useEffect(() => {
    if (!profile) return;
    setLoadingEfforts(true);
    fetch(`/api/events/${eventId}/climb/${climbIdx}/results`)
      .then(r => r.json())
      .then(d => { setEfforts(d.efforts ?? []); })
      .catch(() => {})
      .finally(() => setLoadingEfforts(false));
  }, [eventId, climbIdx, profile]);

  function handleSave() {
    if (!profile || !event || !climb) return;
    const updatedClimbs = (event.pacing_strategy?.climbs ?? []).map((c, i) =>
      i === climbIdx ? { ...c, target_watts: targetWatts } : c
    );
    const updatedEvent = {
      ...event,
      pacing_strategy: { ...event.pacing_strategy!, climbs: updatedClimbs },
    };
    const events = profile.events.map(e => (e.id ?? '') === eventId ? updatedEvent : e);
    const merged = { ...profile, events };
    setProfile(merged);
    save(merged);
    router.push(`/events/${eventId}`);
  }

  if (!profile || !event) {
    return (
      <div className="h-full flex flex-col">
        <PageHeader icon={iconFor('events')} title="Climb" />
        <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">Loading…</div>
      </div>
    );
  }

  if (!climb) {
    return (
      <div className="h-full flex flex-col">
        <PageHeader icon={iconFor('events')} title="Climb" />
        <div className="flex-shrink-0 px-4 py-2 border-b border-gray-800/60">
          <Link href={`/events/${eventId}`} className="text-sm text-gray-500 hover:text-orange-400 transition-colors">
            ← {event.name || 'Event'}
          </Link>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="text-gray-400 text-sm">Climb data not saved yet.</p>
          <Link href={`/events/${eventId}`} className="mt-2 px-4 py-2 bg-orange-500/20 text-orange-400 rounded-lg text-sm hover:bg-orange-500/30 transition-colors">
            ← Back to Event
          </Link>
        </div>
      </div>
    );
  }

  const altMin    = chartData.length ? Math.min(...chartData.map(p => p.alt)) : 0;
  const altMax    = chartData.length ? Math.max(...chartData.map(p => p.alt)) : 0;
  const domainMin = Math.max(0, altMin - 20);

  const saveBtn = (
    <button onClick={handleSave} disabled={saving}
      className="px-4 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-medium transition-colors">
      {saving ? 'Saving…' : 'Save'}
    </button>
  );

  return (
    <div className="h-full flex flex-col">
      <PageHeader icon={iconFor('events')} title={climb.name} right={saveBtn} />

      <div className="flex-shrink-0 px-4 md:px-8 py-2 border-b border-gray-800/60">
        <Link href={`/events/${eventId}`} className="text-sm text-gray-500 hover:text-orange-400 transition-colors">
          ← {event.name || 'Event'}
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto scroll-touch">
        <div className="max-w-2xl md:max-w-5xl mx-auto px-4 py-4 md:px-8 md:py-6 space-y-5">

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'From Start', value: `${climb.start_km} km`,       color: 'text-white' },
              { label: 'Length',     value: `${climb.distance_km} km`,    color: 'text-white' },
              { label: 'Ascent',     value: `${climb.elevation_gain} m`,  color: 'text-orange-400' },
              { label: 'Gradient',   value: `${climb.avg_gradient}%`,     color: 'text-white' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</p>
                <p className={`text-lg font-bold ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* Elevation profile */}
          {chartData.length > 0 && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Elevation Profile</h2>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="climbGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#f97316" stopOpacity={0.5} />
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                  <XAxis dataKey="km" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false}
                    tickFormatter={v => `${v}km`} interval="preserveStartEnd" />
                  <YAxis domain={[domainMin, altMax + 20]} tick={{ fill: '#6b7280', fontSize: 10 }}
                    axisLine={false} tickLine={false} width={40} tickFormatter={v => `${v}m`} />
                  <ReferenceLine y={altMin} stroke="#374151" strokeDasharray="3 3"
                    label={{ value: `${altMin}m`, fill: '#6b7280', fontSize: 9, position: 'insideBottomLeft' }} />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-xs">
                        <p className="text-gray-400">{payload[0].payload.km} km in</p>
                        <p className="text-white font-semibold">{payload[0].value} m</p>
                      </div>
                    );
                  }} />
                  <Area type="monotone" dataKey="alt" stroke="#f97316" strokeWidth={2}
                    fill="url(#climbGrad)" dot={false} activeDot={{ r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </section>
          )}

          {/* Target power + speed */}
          <section className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-4">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Target Power</h2>

            <div className="grid grid-cols-2 gap-3">
              {/* Watts input */}
              <div>
                <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Power (W)</label>
                <input
                  type="number"
                  value={targetWatts}
                  onChange={e => {
                    const w = parseInt(e.target.value, 10);
                    if (!isNaN(w) && w > 0) {
                      setTargetWatts(w);
                      setSpeedDraft('');
                    }
                  }}
                  className={inputCls}
                  step={5} min={50} max={700}
                />
              </div>

              {/* Speed input — linked to watts via avg_gradient */}
              <div>
                <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Avg Speed (km/h)</label>
                <input
                  type="number"
                  value={displaySpeed}
                  onChange={e => setSpeedDraft(e.target.value)}
                  onBlur={() => {
                    const s = parseFloat(speedDraft);
                    if (!isNaN(s) && s > 0) {
                      const w = powerForSpeed(s / 3.6, (climb.avg_gradient) / 100, totalKg);
                      if (w > 0) setTargetWatts(w);
                    }
                    setSpeedDraft('');
                  }}
                  className={inputCls}
                  step={0.5} min={1} max={60}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">
                {riderKg} kg rider · {bikeKg} kg bike · {Math.round(targetWatts / riderKg * 10) / 10} W/kg
              </p>
              <div className="text-right">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Est Time</p>
                <p className="text-2xl font-bold text-white tabular-nums">
                  {estMin ? fmtTime(estMin) : '—'}
                </p>
              </div>
            </div>
          </section>

          {/* Previous results */}
          <section className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="p-4">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Previous Results</h2>
              <p className="text-[10px] text-gray-600 mt-0.5">
                Strava segment efforts matching this climb length (±25%)
              </p>
            </div>

            {loadingEfforts ? (
              <div className="border-t border-gray-800 divide-y divide-gray-800/40">
                {[0, 1, 2].map(i => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 h-3 bg-gray-800 rounded animate-pulse" />
                    <div className="w-12 h-3 bg-gray-800 rounded animate-pulse" />
                    <div className="w-16 h-3 bg-gray-800 rounded animate-pulse" />
                  </div>
                ))}
              </div>
            ) : efforts.length === 0 ? (
              <div className="border-t border-gray-800 px-4 py-6 text-center">
                <p className="text-gray-600 text-sm">No matching segment efforts found</p>
                <p className="text-gray-700 text-xs mt-1">Run the activities backfill to import segment data</p>
              </div>
            ) : (
              <div className="border-t border-gray-800 divide-y divide-gray-800/40">
                {efforts.map((e, i) => {
                  const isPR  = e.pr_rank === 1;
                  const isTop3 = e.pr_rank !== null && e.pr_rank <= 3;
                  return (
                    <Link
                      key={e.id}
                      href={`/activities/${e.activity_id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-800/40 transition-colors"
                    >
                      {/* Rank badge */}
                      <span className="w-5 text-[10px] font-bold text-gray-600 flex-shrink-0 text-center">{i + 1}</span>

                      {/* Segment name + activity */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white font-medium truncate">{e.name}</p>
                        <p className="text-[10px] text-gray-500 truncate">{e.activity_name} · {e.date}</p>
                      </div>

                      {/* PR badge */}
                      {isPR && (
                        <span className="flex-shrink-0 px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 text-[10px] font-bold">PR</span>
                      )}
                      {!isPR && isTop3 && (
                        <span className="flex-shrink-0 px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 text-[10px] font-bold">Top {e.pr_rank}</span>
                      )}

                      {/* Power */}
                      {e.average_watts && (
                        <span className="flex-shrink-0 text-xs text-gray-400 w-12 text-right">{e.average_watts}W</span>
                      )}

                      {/* Time */}
                      <span className="flex-shrink-0 text-sm font-bold text-white tabular-nums w-14 text-right">
                        {fmtSecs(e.moving_time)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          <div className="h-20" />
        </div>
      </div>
    </div>
  );
}
