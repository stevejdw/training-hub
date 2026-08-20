'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { useProfileEdit, inputCls } from '@/lib/use-profile-edit';
import PageHeader from '@/components/PageHeader';
import EnlargeableChart from '@/components/EnlargeableChart';
import { iconFor } from '@/components/nav-items';
import { estimateTime, fmtTime, speedForPower, powerForSpeed } from '@/lib/pacing';
import Link from 'next/link';
import SaveStatus from '@/components/ui/SaveStatus';
import { CHART } from '@/lib/chart-theme';

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
  const { profile, setProfile, save, saving, error } = useProfileEdit();

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
  const ftp     = profile?.use_eftp && profile?.eftp ? profile.eftp : (profile?.ftp ?? 300);
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
      ftp,
    });
  }, [route, climb, chartData, targetWatts, riderKg, bikeKg, ftp]);

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
        <div className="flex-1 flex items-center justify-center text-ink-5 text-sm">Loading…</div>
      </div>
    );
  }

  if (!climb) {
    return (
      <div className="h-full flex flex-col">
        <PageHeader icon={iconFor('events')} title="Climb" />
        <div className="flex-shrink-0 px-4 py-2 border-b border-line/60">
          <Link href={`/events/${eventId}`} className="text-sm text-ink-4 hover:text-accent-hi transition-colors">
            ← {event.name || 'Event'}
          </Link>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="text-ink-3 text-sm">Climb data not saved yet.</p>
          <Link href={`/events/${eventId}`} className="mt-2 px-4 py-2 bg-accent/20 text-accent-hi rounded-lg text-sm hover:bg-accent/30 transition-colors">
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
    <div className="flex items-center gap-3">
      <SaveStatus error={error} onRetry={handleSave} />
      <button onClick={handleSave} disabled={saving}
        className="px-4 py-1.5 rounded-lg bg-accent hover:bg-accent-hi disabled:opacity-50 text-ink text-sm font-medium transition-colors">
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      <PageHeader icon={iconFor('events')} title={climb.name} right={saveBtn} showSettings={false} />

      <div className="flex-shrink-0 px-4 md:px-8 py-2 border-b border-line/60">
        <Link href={`/events/${eventId}`} className="text-sm text-ink-4 hover:text-accent-hi transition-colors">
          ← {event.name || 'Event'}
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto scroll-touch">
        <div className="max-w-2xl md:max-w-5xl xl:max-w-7xl mx-auto px-4 py-4 md:px-8 md:py-6 space-y-5 pb-nav">

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'From Start', value: `${climb.start_km} km`,       color: 'text-ink' },
              { label: 'Length',     value: `${climb.distance_km} km`,    color: 'text-ink' },
              { label: 'Ascent',     value: `${climb.elevation_gain} m`,  color: 'text-accent-hi' },
              { label: 'Gradient',   value: `${climb.avg_gradient}%`,     color: 'text-ink' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-surface border border-line rounded-xl p-3 text-center">
                <p className="text-micro text-ink-4 uppercase tracking-wider mb-1">{label}</p>
                <p className={`text-lg font-bold ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* Elevation profile */}
          {chartData.length > 0 && (
            <section className="bg-surface border border-line rounded-2xl p-4">
              <h2 className="text-xs font-semibold text-ink-4 uppercase tracking-wider mb-3">Elevation Profile</h2>
              <EnlargeableChart title={`${climb.name} — Elevation Profile`}>
                {(fs) => (
                  <ResponsiveContainer width="100%" height={fs ? '100%' : 180}>
                    <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="climbGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={CHART.power} stopOpacity={0.5} />
                          <stop offset="95%" stopColor={CHART.power} stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                      <XAxis dataKey="km" tick={{ fill: CHART.axisText, fontSize: 10 }} axisLine={false} tickLine={false}
                        tickFormatter={v => `${v}km`} interval="preserveStartEnd" />
                      <YAxis domain={[domainMin, altMax + 20]} tick={{ fill: CHART.axisText, fontSize: 10 }}
                        axisLine={false} tickLine={false} width={40} tickFormatter={v => `${v}m`} />
                      <ReferenceLine y={altMin} stroke={CHART.axis} strokeDasharray="3 3"
                        label={{ value: `${altMin}m`, fill: CHART.axisText, fontSize: 9, position: 'insideBottomLeft' }} />
                      <Tooltip content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div className="bg-surface border border-line-strong rounded-lg px-2 py-1 text-xs">
                            <p className="text-ink-3">{payload[0].payload.km} km in</p>
                            <p className="text-ink font-semibold">{payload[0].value} m</p>
                          </div>
                        );
                      }} />
                      <Area type="monotone" dataKey="alt" stroke={CHART.power} strokeWidth={2}
                        fill="url(#climbGrad)" dot={false} activeDot={{ r: 3 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </EnlargeableChart>
            </section>
          )}

          {/* Target power + speed */}
          <section className="bg-surface border border-line rounded-2xl p-4 space-y-4">
            <h2 className="text-xs font-semibold text-ink-4 uppercase tracking-wider">Target Power</h2>

            <div className="grid grid-cols-2 gap-3">
              {/* Watts input */}
              <div>
                <label className="block text-micro text-ink-4 uppercase tracking-wider mb-1">Power (W)</label>
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
                <label className="block text-micro text-ink-4 uppercase tracking-wider mb-1">Avg Speed (km/h)</label>
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
              <p className="text-xs text-ink-4">
                {riderKg} kg rider · {bikeKg} kg bike · {Math.round(targetWatts / riderKg * 10) / 10} W/kg
              </p>
              <div className="text-right">
                <p className="text-micro text-ink-4 uppercase tracking-wider mb-0.5">Est Time</p>
                <p className="text-2xl font-bold text-ink tabular-nums">
                  {estMin ? fmtTime(estMin) : '—'}
                </p>
              </div>
            </div>
          </section>

          {/* Previous results */}
          <section className="bg-surface border border-line rounded-2xl overflow-hidden">
            <div className="p-4">
              <h2 className="text-xs font-semibold text-ink-4 uppercase tracking-wider">Previous Results</h2>
              <p className="text-micro text-ink-5 mt-0.5">
                Strava segment efforts matching this climb length (±25%)
              </p>
            </div>

            {loadingEfforts ? (
              <div className="border-t border-line divide-y divide-line/40">
                {[0, 1, 2].map(i => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 h-3 bg-raised rounded animate-pulse" />
                    <div className="w-12 h-3 bg-raised rounded animate-pulse" />
                    <div className="w-16 h-3 bg-raised rounded animate-pulse" />
                  </div>
                ))}
              </div>
            ) : efforts.length === 0 ? (
              <div className="border-t border-line px-4 py-6 text-center">
                <p className="text-ink-5 text-sm">No matching segment efforts found</p>
                <p className="text-ink-5 text-xs mt-1">Run the activities backfill to import segment data</p>
              </div>
            ) : (
              <div className="border-t border-line divide-y divide-line/40">
                {efforts.map((e, i) => {
                  const isPR  = e.pr_rank === 1;
                  const isTop3 = e.pr_rank !== null && e.pr_rank <= 3;
                  return (
                    <Link
                      key={e.id}
                      href={`/activities/${e.activity_id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-raised/40 transition-colors"
                    >
                      {/* Rank badge */}
                      <span className="w-5 text-micro font-bold text-ink-5 flex-shrink-0 text-center">{i + 1}</span>

                      {/* Segment name + activity */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-ink font-medium truncate">{e.name}</p>
                        <p className="text-micro text-ink-4 truncate">{e.activity_name} · {e.date}</p>
                      </div>

                      {/* PR badge */}
                      {isPR && (
                        <span className="flex-shrink-0 px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 text-micro font-bold">PR</span>
                      )}
                      {!isPR && isTop3 && (
                        <span className="flex-shrink-0 px-1.5 py-0.5 rounded bg-accent/20 text-accent-hi text-micro font-bold">Top {e.pr_rank}</span>
                      )}

                      {/* Power */}
                      {e.average_watts && (
                        <span className="flex-shrink-0 text-xs text-ink-3 w-12 text-right">{e.average_watts}W</span>
                      )}

                      {/* Time */}
                      <span className="flex-shrink-0 text-sm font-bold text-ink tabular-nums w-14 text-right">
                        {fmtSecs(e.moving_time)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

        </div>
      </div>
    </div>
  );
}
