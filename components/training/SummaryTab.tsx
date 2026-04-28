'use client';

import { useEffect, useState } from 'react';

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

function sportEmoji(sport: string) {
  if (sport.includes('Virtual')) return '💻';
  if (sport.includes('Gravel')) return '🪨';
  if (sport.includes('Mountain') || sport.includes('MTB')) return '⛰️';
  if (sport.includes('EBike') || sport.includes('EMountain')) return '⚡';
  return '🚴';
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
  const actsByDate = new Map<string, ActivityRow[]>();
  for (const a of week.activities) {
    const arr = actsByDate.get(a.date) ?? [];
    arr.push(a);
    actsByDate.set(a.date, arr);
  }

  const totalTime = week.activities.reduce((s, a) => s + a.moving_time, 0);
  const totalDist = week.activities.reduce((s, a) => s + a.distance, 0);
  const totalTSS  = week.activities.reduce((s, a) => s + a.tss, 0);
  const rideCount = week.activities.length;

  // Format week label: "14–20 Apr" or "14–20 Apr 2025"
  // Use UTC dates to avoid timezone shifting
  const d1 = new Date(dates[0] + 'T00:00:00Z');
  const d7 = new Date(dates[6] + 'T00:00:00Z');
  const today = new Date();
  const currentYear = today.getFullYear();
  const monthFmt = new Intl.DateTimeFormat('en-AU', { month: 'short', timeZone: 'UTC' });
  const weekLabel = d1.getUTCMonth() === d7.getUTCMonth()
    ? `${d1.getUTCDate()}–${d7.getUTCDate()} ${monthFmt.format(d1)}${d1.getUTCFullYear() !== currentYear ? ` ${d1.getUTCFullYear()}` : ''}`
    : `${d1.getUTCDate()} ${monthFmt.format(d1)} – ${d7.getUTCDate()} ${monthFmt.format(d7)}${d7.getUTCFullYear() !== currentYear ? ` ${d7.getUTCFullYear()}` : ''}`;

  const current = isCurrentWeek(week.week_start);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const dot = alignmentDot(totalTSS, week.target_tss ?? 0);

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

      {/* Horizontal row: Mon — Sun cells + prominent Total cell */}
      <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_minmax(112px,1.6fr)]">
        {dates.map((date, i) => {
          const acts = actsByDate.get(date) ?? [];
          const isToday  = date === todayStr;
          const isFuture = date > todayStr;
          const dayKm   = acts.reduce((s, a) => s + a.distance, 0) / 1000;
          const dayMin  = acts.reduce((s, a) => s + a.moving_time, 0) / 60;
          const dayTSS  = acts.reduce((s, a) => s + a.tss, 0);
          const primary = acts[0];
          const href    = primary ? `/activities/${primary.id}` : undefined;
          const Wrapper = (props: { children: React.ReactNode }) =>
            href
              ? <a href={href} className="block h-full hover:bg-gray-800/60 transition-colors">{props.children}</a>
              : <div className="h-full">{props.children}</div>;

          return (
            <div
              key={date}
              className={`border-r border-gray-800 ${isToday ? 'bg-gray-800/40' : ''} ${isFuture ? 'opacity-40' : ''}`}
            >
              <Wrapper>
                <div className="px-1.5 py-2 flex flex-col items-center gap-0.5 min-h-[64px]">
                  <div className={`text-[10px] font-medium uppercase tracking-wider ${isToday ? 'text-orange-400' : 'text-gray-500'}`}>
                    {DAY_LABELS[i]}
                  </div>
                  <div className={`text-[10px] ${isToday ? 'text-orange-400/70' : 'text-gray-600'} mb-0.5`}>
                    {Number(date.slice(8, 10))}
                  </div>
                  {acts.length === 0 ? (
                    <span className="text-gray-700 text-[10px]">—</span>
                  ) : (
                    <>
                      <span className="text-base leading-none" title={acts.map(a => `${a.name} · ${a.tss} TSS`).join('\n')}>
                        {sportEmoji(primary.sport_type)}
                        {acts.length > 1 && <span className="text-[9px] text-gray-500 ml-0.5">×{acts.length}</span>}
                      </span>
                      <div className="text-[10px] text-gray-300 leading-tight text-center">
                        {dayKm > 0 && <span>{Math.round(dayKm)}km</span>}
                        {dayKm > 0 && dayMin > 0 && <span className="text-gray-600 mx-0.5">·</span>}
                        {dayMin > 0 && <span>{Math.round(dayMin)}m</span>}
                      </div>
                      {dayTSS > 0 && (
                        <div className="text-[10px] text-gray-500">{dayTSS}</div>
                      )}
                    </>
                  )}
                </div>
              </Wrapper>
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
