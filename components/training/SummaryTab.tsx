'use client';

import { useEffect, useRef, useState } from 'react';

const CYCLING_TYPES = new Set(['Ride','VirtualRide','GravelRide','MountainBikeRide','EBikeRide','EMountainBikeRide']);

interface ActivityRow {
  id: number;
  name: string;
  sport_type: string;
  date: string;
  moving_time: number;
  distance: number;
  tss: number;
}

interface WeekRow {
  week_start: string;
  week_end: string;
  target_tss?: number;
  activities: ActivityRow[];
}

function alignmentDot(actualTSS: number, targetTSS: number) {
  if (!targetTSS) return null;
  const ratio = actualTSS / targetTSS;
  // ±15% on plan = green, ±15-40% = orange, else yellow
  if (ratio >= 0.85 && ratio <= 1.15) return { color: 'bg-green-500',  label: 'On plan'  };
  if (ratio >= 0.60 && ratio <= 1.40) return { color: 'bg-orange-500', label: 'Close'    };
  return { color: 'bg-yellow-500', label: 'Off plan' };
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function fmtHrs(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function fmtKm(meters: number) {
  return (meters / 1000).toFixed(0) + 'km';
}

function sportShort(sport: string): string {
  if (sport.includes('Virtual')) return 'Virtual';
  if (sport.includes('Gravel')) return 'Gravel';
  if (sport.includes('EBike') || sport.includes('EMountain')) return 'eBike';
  if (sport.includes('Mountain') || sport.includes('MTB')) return 'MTB';
  return 'Ride';
}

function ActivityLine({ a }: { a: ActivityRow }) {
  const km = (a.distance / 1000);
  const min = Math.round(a.moving_time / 60);
  return (
    <a
      href={`/activities/${a.id}`}
      className="block px-1 py-0.5 rounded hover:bg-gray-700/60 transition-colors"
      title={a.name}
    >
      <div className="text-[10px] text-gray-300 leading-tight font-medium truncate">{sportShort(a.sport_type)}</div>
      <div className="text-[10px] text-gray-400 leading-tight">
        {km > 0 && <span>{km >= 100 ? Math.round(km) : km.toFixed(0)}k</span>}
        {km > 0 && min > 0 && <span className="text-gray-600 mx-0.5">·</span>}
        {min > 0 && <span>{min}m</span>}
        {a.tss > 0 && <span className="text-gray-500 ml-1">{a.tss}T</span>}
      </div>
    </a>
  );
}

/** Wraps a tappable cell that opens the same multi-activity popover when
 *  pressed. Used by the mobile day-strip when a day has 2+ rides. */
function DayPopoverWrapper({ acts, children }: { acts: ActivityRow[]; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} className="block w-full text-left">
        {children}
      </button>
      {open && (
        <div className="absolute z-30 left-1/2 -translate-x-1/2 mt-1 w-44 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl py-1">
          {acts.map(a => {
            const km = a.distance / 1000;
            const min = Math.round(a.moving_time / 60);
            return (
              <a
                key={a.id}
                href={`/activities/${a.id}`}
                className="block px-3 py-2 hover:bg-gray-800 transition-colors"
              >
                <div className="text-xs text-gray-200 truncate font-medium">{a.name}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">
                  {sportShort(a.sport_type)}
                  {km > 0 && <> · {km >= 100 ? Math.round(km) : km.toFixed(1)} km</>}
                  {min > 0 && <> · {min} min</>}
                  {a.tss > 0 && <> · {a.tss} TSS</>}
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MoreActivitiesPopover({ acts }: { acts: ActivityRow[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        className="text-[10px] text-orange-400 hover:text-orange-300 transition-colors"
      >
        +{acts.length} more
      </button>
      {open && (
        <div className="absolute z-30 left-1/2 -translate-x-1/2 mt-1 w-44 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl py-1">
          {acts.map(a => {
            const km = a.distance / 1000;
            const min = Math.round(a.moving_time / 60);
            return (
              <a
                key={a.id}
                href={`/activities/${a.id}`}
                className="block px-3 py-2 hover:bg-gray-800 transition-colors"
              >
                <div className="text-xs text-gray-200 truncate font-medium">{a.name}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">
                  {sportShort(a.sport_type)}
                  {km > 0 && <> · {km >= 100 ? Math.round(km) : km.toFixed(1)} km</>}
                  {min > 0 && <> · {min} min</>}
                  {a.tss > 0 && <> · {a.tss} TSS</>}
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Get the 7 dates for a week starting on week_start (Monday).
// Use Date.UTC to avoid local-timezone shifts when converting back to ISO string.
function weekDates(weekStart: string): string[] {
  const [y, m, d] = weekStart.split('-').map(Number);
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    return dt.toISOString().slice(0, 10);
  });
}

function isCurrentWeek(weekStart: string) {
  // Compare against today in local time
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const dates = weekDates(weekStart);
  return dates.includes(todayStr);
}

function WeekCard({ week, isFirst }: { week: WeekRow; isFirst: boolean }) {
  const dates = weekDates(week.week_start);
  // Defensive client-side filter — only keep cycling activities.
  const cyclingActs = week.activities.filter(a => CYCLING_TYPES.has(a.sport_type));
  const actsByDate = new Map<string, ActivityRow[]>();
  for (const a of cyclingActs) {
    const arr = actsByDate.get(a.date) ?? [];
    arr.push(a);
    actsByDate.set(a.date, arr);
  }

  const totalTime = cyclingActs.reduce((s, a) => s + a.moving_time, 0);
  const totalDist = cyclingActs.reduce((s, a) => s + a.distance, 0);
  const totalTSS  = cyclingActs.reduce((s, a) => s + a.tss, 0);
  const rideCount = cyclingActs.length;

  // Format week label: "14–20 Apr" or "14–20 Apr 2025"
  // Use UTC dates to avoid timezone shifting
  const d1 = new Date(dates[0] + 'T00:00:00Z');
  const d7 = new Date(dates[6] + 'T00:00:00Z');
  const today = new Date();
  const currentYear = today.getFullYear();
  const monthFmt = new Intl.DateTimeFormat('en-AU', { month: 'long', timeZone: 'UTC' });
  const weekLabel = d1.getUTCMonth() === d7.getUTCMonth()
    ? `${d1.getUTCDate()}–${d7.getUTCDate()} ${monthFmt.format(d1)}${d1.getUTCFullYear() !== currentYear ? ` ${d1.getUTCFullYear()}` : ''}`
    : `${d1.getUTCDate()} ${monthFmt.format(d1)} – ${d7.getUTCDate()} ${monthFmt.format(d7)}${d7.getUTCFullYear() !== currentYear ? ` ${d7.getUTCFullYear()}` : ''}`;

  const current = isCurrentWeek(week.week_start);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const dot = alignmentDot(totalTSS, week.target_tss ?? 0);

  // Mobile-only single-letter day labels to avoid overlap.
  const SHORT_DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  return (
    <div className={`rounded-xl overflow-hidden border ${current ? 'border-orange-500/40' : 'border-gray-800'}`}>
      {/* Compact header: week label + alignment dot */}
      <div className={`flex items-center justify-between px-3 py-1.5 ${current ? 'bg-orange-500/10' : 'bg-gray-800/60'}`}>
        <div className="flex items-center gap-2 min-w-0">
          {current && <span className="w-1.5 h-1.5 rounded-full bg-orange-500 flex-shrink-0" />}
          <span className={`text-sm font-semibold truncate ${current ? 'text-orange-400' : 'text-gray-300'}`}>
            {isFirst && current ? 'This week' : weekLabel}
          </span>
          {isFirst && current && (
            <span className="text-[11px] text-gray-500 flex-shrink-0 hidden sm:inline">{weekLabel}</span>
          )}
        </div>
        {dot && (
          <span
            title={`Plan target: ${week.target_tss} TSS — ${dot.label}`}
            className="flex items-center gap-1.5 flex-shrink-0"
          >
            <span className={`w-2.5 h-2.5 rounded-full ${dot.color}`} />
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">{dot.label}</span>
          </span>
        )}
      </div>

      {/* ── Mobile layout: Total prominent at top, then a compact 7-day strip ── */}
      <div className="md:hidden">
        {/* Big Total */}
        <div className={`flex items-center justify-between px-4 py-3 ${current ? 'bg-orange-500/10' : 'bg-gray-800/40'}`}>
          {rideCount > 0 ? (
            <>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-white leading-none">{Math.round(totalDist / 1000)}</span>
                <span className="text-[11px] text-gray-500 uppercase">km</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-white leading-none">{fmtHrs(totalTime)}</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className={`text-2xl font-bold leading-none ${current ? 'text-orange-300' : 'text-gray-200'}`}>{totalTSS}</span>
                <span className="text-[11px] text-gray-500 uppercase">tss</span>
                {week.target_tss ? (
                  <span className="text-[10px] text-gray-600 ml-1">/ {week.target_tss}</span>
                ) : null}
              </div>
            </>
          ) : (
            <span className="text-sm text-gray-600">No rides this week</span>
          )}
        </div>
        {/* Compact 7-day strip */}
        <div className="grid grid-cols-7 border-t border-gray-800">
          {dates.map((date, i) => {
            const acts     = actsByDate.get(date) ?? [];
            const isToday  = date === todayStr;
            const isFuture = date > todayStr;
            const dayKm    = acts.reduce((s, a) => s + a.distance, 0) / 1000;
            const hasActs  = acts.length > 0;
            const cellInner = (
              <div className={`flex flex-col items-center py-1.5 ${i < 6 ? 'border-r border-gray-800' : ''} ${isToday ? 'bg-gray-800/40' : ''} ${isFuture ? 'opacity-40' : ''}`}>
                <span className={`text-[10px] font-medium ${isToday ? 'text-orange-400' : 'text-gray-500'}`}>
                  {SHORT_DAY_LABELS[i]}
                </span>
                <span className={`text-[10px] ${isToday ? 'text-orange-400/70' : 'text-gray-600'}`}>
                  {Number(date.slice(8, 10))}
                </span>
                <span className={`mt-1 text-[11px] font-semibold ${hasActs ? 'text-gray-200' : 'text-gray-700'}`}>
                  {hasActs ? `${Math.round(dayKm)}` : '—'}
                </span>
                {hasActs && acts.length > 1 && (
                  <span className="text-[8px] text-gray-500 mt-0.5">×{acts.length}</span>
                )}
              </div>
            );
            // Tap → if 1 ride, navigate; if 2+, open MoreActivitiesPopover
            if (acts.length === 1) {
              return (
                <a key={date} href={`/activities/${acts[0].id}`} className="block">
                  {cellInner}
                </a>
              );
            }
            if (acts.length >= 2) {
              return (
                <div key={date}>
                  <DayPopoverWrapper acts={acts}>{cellInner}</DayPopoverWrapper>
                </div>
              );
            }
            return <div key={date}>{cellInner}</div>;
          })}
        </div>
      </div>

      {/* ── Desktop layout: original 7 day cells + Total ── */}
      <div className="hidden md:grid md:grid-cols-[repeat(7,minmax(0,1fr))_minmax(112px,1.6fr)]">
        {dates.map((date, i) => {
          const acts     = actsByDate.get(date) ?? [];
          const isToday  = date === todayStr;
          const isFuture = date > todayStr;
          // Up to 2 visible activities; the rest go in a "+N more" popover.
          const visible  = acts.slice(0, 2);
          const overflow = acts.slice(2);

          return (
            <div
              key={date}
              className={`border-r border-gray-800 ${isToday ? 'bg-gray-800/40' : ''} ${isFuture ? 'opacity-40' : ''}`}
            >
              <div className="px-1 py-1.5 flex flex-col items-stretch gap-0.5 min-h-[64px]">
                <div className="flex items-baseline justify-center gap-1">
                  <span className={`text-[10px] font-medium uppercase tracking-wider ${isToday ? 'text-orange-400' : 'text-gray-500'}`}>
                    {DAY_LABELS[i]}
                  </span>
                  <span className={`text-[9px] ${isToday ? 'text-orange-400/70' : 'text-gray-600'}`}>
                    {Number(date.slice(8, 10))}
                  </span>
                </div>
                {acts.length === 0 ? (
                  <span className="text-gray-700 text-[10px] text-center mt-1">—</span>
                ) : (
                  <>
                    {visible.map(a => <ActivityLine key={a.id} a={a} />)}
                    {overflow.length > 0 && (
                      <div className="text-center pt-0.5">
                        <MoreActivitiesPopover acts={overflow} />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}

        {/* Total — prominent */}
        <div className={`px-3 py-2 flex flex-col justify-center gap-0.5 ${current ? 'bg-orange-500/15' : 'bg-gray-800/60'}`}>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Total</div>
          {rideCount > 0 ? (
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-bold text-white leading-none">{Math.round(totalDist / 1000)}</span>
                <span className="text-[10px] text-gray-500 uppercase">km</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-base font-bold text-white leading-none">{fmtHrs(totalTime)}</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className={`text-sm font-bold leading-none ${current ? 'text-orange-300' : 'text-gray-300'}`}>{totalTSS}</span>
                <span className="text-[10px] text-gray-500 uppercase">TSS</span>
                {week.target_tss ? (
                  <span className="text-[10px] text-gray-600 ml-auto">/ {week.target_tss}</span>
                ) : null}
              </div>
            </>
          ) : (
            <span className="text-xs text-gray-600">No rides</span>
          )}
        </div>
      </div>
    </div>
  );
}

const SUMMARY_CACHE_KEY = 'cache-weekly-summary';

export default function SummaryTab() {
  const [weeks, setWeeks] = useState<WeekRow[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const s = localStorage.getItem(SUMMARY_CACHE_KEY);
      return s ? JSON.parse(s) : [];
    } catch { return []; }
  });
  const [loading, setLoading] = useState(() => {
    if (typeof window === 'undefined') return true;
    try { return !localStorage.getItem(SUMMARY_CACHE_KEY); }
    catch { return true; }
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/training/weekly-summary')
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); }
        else {
          setWeeks(data);
          try { localStorage.setItem(SUMMARY_CACHE_KEY, JSON.stringify(data)); } catch {}
        }
        setLoading(false);
      })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="bg-gray-800 rounded-xl h-48 animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-red-400 text-sm">{error}</p>;
  }

  return (
    <div className="space-y-3">
      {weeks.map((week, i) => (
        <WeekCard key={week.week_start} week={week} isFirst={i === 0} />
      ))}
    </div>
  );
}
