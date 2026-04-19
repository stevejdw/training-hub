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
  activities: ActivityRow[];
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

  return (
    <div className={`rounded-xl overflow-hidden border ${current ? 'border-orange-500/40' : 'border-gray-800'}`}>
      {/* Week header */}
      <div className={`flex items-center justify-between px-4 py-2.5 ${current ? 'bg-orange-500/10' : 'bg-gray-800/60'}`}>
        <div className="flex items-center gap-2">
          {current && <span className="w-1.5 h-1.5 rounded-full bg-orange-500 flex-shrink-0" />}
          <span className={`text-sm font-semibold ${current ? 'text-orange-400' : 'text-gray-300'}`}>
            {isFirst && current ? 'This week' : weekLabel}
          </span>
          {isFirst && current && (
            <span className="text-xs text-gray-500">{weekLabel}</span>
          )}
        </div>
        {rideCount > 0 && (
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span>{rideCount} ride{rideCount !== 1 ? 's' : ''}</span>
            <span>{fmtHrs(totalTime)}</span>
            <span>{fmtKm(totalDist)}</span>
            {totalTSS > 0 && <span className="text-gray-500">{totalTSS} TSS</span>}
          </div>
        )}
      </div>

      {/* Day rows */}
      <div className="divide-y divide-gray-800">
        {dates.map((date, i) => {
          const acts = actsByDate.get(date) ?? [];
          const isToday = date === todayStr;
          const isFuture = date > todayStr;

          return (
            <div
              key={date}
              className={`flex items-start gap-3 px-4 py-2 ${
                isToday ? 'bg-gray-800/40' : isFuture ? 'opacity-40' : ''
              }`}
            >
              {/* Day label */}
              <div className="w-10 flex-shrink-0 pt-0.5">
                <span className={`text-xs font-medium ${isToday ? 'text-orange-400' : 'text-gray-500'}`}>
                  {DAY_LABELS[i]}
                </span>
                <div className={`text-[10px] ${isToday ? 'text-orange-400/70' : 'text-gray-600'}`}>
                  {Number(date.slice(8, 10))}
                </div>
              </div>

              {/* Activities */}
              <div className="flex-1 min-w-0 space-y-1">
                {acts.length === 0 ? (
                  <div className="h-5 flex items-center">
                    <span className="text-[11px] text-gray-700">—</span>
                  </div>
                ) : (
                  acts.map(a => (
                    <a
                      key={a.id}
                      href={`/activities/${a.id}`}
                      className="flex items-center gap-2 group"
                    >
                      <span className="text-green-500 flex-shrink-0">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </span>
                      <span className="text-xs text-gray-300 truncate group-hover:text-white transition-colors">
                        {sportEmoji(a.sport_type)} {a.name}
                      </span>
                      <span className="text-[10px] text-gray-600 flex-shrink-0 ml-auto flex gap-2">
                        <span>{fmtHrs(a.moving_time)}</span>
                        {a.distance > 0 && <span>{fmtKm(a.distance)}</span>}
                        {a.tss > 0 && <span>{a.tss} TSS</span>}
                      </span>
                    </a>
                  ))
                )}
              </div>
            </div>
          );
        })}
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
