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
import { estimateTime, fmtTime } from '@/lib/pacing';
import Link from 'next/link';

interface Props { eventId: string; climbIdx: number }

export default function ClimbDetailPage({ eventId, climbIdx }: Props) {
  const router = useRouter();
  const { profile, setProfile, save, saving } = useProfileEdit();

  const event = profile?.events.find(e => (e.id ?? '') === eventId) ?? null;
  const climb = event?.pacing_strategy?.climbs?.[climbIdx] ?? null;
  const route = event?.route ?? null;

  const [targetWatts, setTargetWatts] = useState(climb?.target_watts ?? 240);

  useEffect(() => {
    if (climb?.target_watts) setTargetWatts(climb.target_watts);
  }, [climb?.target_watts]);

  // Slice route streams to just this climb
  const chartData = useMemo(() => {
    if (!route || !climb) return [];
    const pts: { km: number; alt: number }[] = [];
    for (let i = 0; i < route.stream_distance_km.length; i++) {
      const d = route.stream_distance_km[i];
      if (d >= climb.start_km && d <= climb.end_km) {
        pts.push({ km: Math.round((d - climb.start_km) * 10) / 10, alt: route.stream_altitude_m[i] });
      }
    }
    return pts;
  }, [route, climb]);

  const riderKg = profile?.weight_kg ?? 75;
  const bikeKg  = profile?.bike_weight_kg ?? 8;

  const estMin = useMemo(() => {
    if (!route || !climb || chartData.length < 2) return null;
    const sliceD = chartData.map(p => p.km + climb.start_km);
    const sliceA = chartData.map(p => p.alt);
    return estimateTime({
      stream_distance_km: sliceD,
      stream_altitude_m:  sliceA,
      flat_watts:         targetWatts,
      descent_watts:      targetWatts,
      climbs:             [],
      rider_weight_kg:    riderKg,
      bike_weight_kg:     bikeKg,
    });
  }, [route, climb, chartData, targetWatts, riderKg, bikeKg]);

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

  if (!profile || !event || !climb) {
    return (
      <div className="h-full flex flex-col">
        <PageHeader icon={iconFor('events')} title="Climb" />
        <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">Loading…</div>
      </div>
    );
  }

  const saveBtn = (
    <button
      onClick={handleSave}
      disabled={saving}
      className="px-4 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-medium transition-colors"
    >
      {saving ? 'Saving…' : 'Save'}
    </button>
  );

  const altMin = chartData.length ? Math.min(...chartData.map(p => p.alt)) : 0;
  const altMax = chartData.length ? Math.max(...chartData.map(p => p.alt)) : 0;
  const domainMin = Math.max(0, altMin - 20);

  return (
    <div className="h-full flex flex-col">
      <PageHeader icon={iconFor('events')} title={climb.name} right={saveBtn} />

      <div className="flex-shrink-0 px-4 md:px-8 py-2 border-b border-gray-800/60">
        <Link href={`/events/${eventId}`} className="text-sm text-gray-500 hover:text-orange-400 transition-colors">
          ← {event.name || 'Event'}
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto scroll-touch">
        <div className="max-w-2xl mx-auto px-4 py-4 md:px-8 md:py-6 space-y-5">

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">From Start</p>
              <p className="text-lg font-bold text-white">{climb.start_km} km</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Length</p>
              <p className="text-lg font-bold text-white">{climb.distance_km} km</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Ascent</p>
              <p className="text-lg font-bold text-orange-400">{climb.elevation_gain} m</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Gradient</p>
              <p className="text-lg font-bold text-white">{climb.avg_gradient}%</p>
            </div>
          </div>

          {/* Elevation profile */}
          {chartData.length > 0 && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Elevation Profile</h2>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="climbGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#f97316" stopOpacity={0.5} />
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                  <XAxis
                    dataKey="km"
                    tick={{ fill: '#6b7280', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={v => `${v} km`}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={[domainMin, altMax + 20]}
                    tick={{ fill: '#6b7280', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                    tickFormatter={v => `${v}m`}
                  />
                  <ReferenceLine
                    y={altMin}
                    stroke="#374151"
                    strokeDasharray="3 3"
                    label={{ value: `${altMin}m`, fill: '#6b7280', fontSize: 9, position: 'insideBottomLeft' }}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-xs">
                          <p className="text-gray-400">{payload[0].payload.km} km from climb start</p>
                          <p className="text-white font-semibold">{payload[0].value} m</p>
                        </div>
                      );
                    }}
                  />
                  <Area type="monotone" dataKey="alt" stroke="#f97316" strokeWidth={2} fill="url(#climbGrad)" dot={false} activeDot={{ r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </section>
          )}

          {/* Target watts + est time */}
          <section className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-4">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Target Power</h2>

            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Target Watts</label>
                <input
                  type="number"
                  value={targetWatts}
                  onChange={e => setTargetWatts(Number(e.target.value))}
                  className={inputCls}
                  step={5}
                  min={50}
                  max={600}
                />
              </div>
              <div className="text-right">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Estimated Time</p>
                <p className="text-3xl font-bold text-white tabular-nums">
                  {estMin ? fmtTime(estMin) : '—'}
                </p>
              </div>
            </div>

            <div className="flex gap-4 text-xs text-gray-500">
              <span>Rider: {riderKg} kg</span>
              <span>Bike: {bikeKg} kg</span>
              <span>System: {riderKg + bikeKg} kg</span>
              <span>W/kg: {Math.round(targetWatts / riderKg * 10) / 10}</span>
            </div>
          </section>

          <div className="h-20" />
        </div>
      </div>
    </div>
  );
}
