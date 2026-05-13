'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { sportLabel, sportColor } from '@/lib/sport-types';
import ReadinessResponseWidget from './ReadinessResponseWidget';
import TssRollingChart from './training/TssRollingChart';
import { calendarDaysFromToday } from '@/lib/calendar-days';

const ActivityMap = dynamic(() => import('./ActivityMap'), { ssr: false });

interface RecentRide {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  distance: number;
  moving_time: number;
  average_watts: number | null;
  normalized_power: number | null;
  average_heartrate: number | null;
  tss: number | null;
  total_elevation_gain: number;
  trainer: boolean;
  summary_polyline: string | null;
  average_speed: number | null;
}

interface PowerHighlight {
  label: string;
  seconds: number;
  watts: number;
  prevBest: number | null;
  isNew: boolean;
}

interface PeriodStats { rides: number; km: number; hours: number; tss: number; elevation: number }

type StatPeriod = 'wtd' | 'mtd' | 'ytd';
const STAT_PERIODS: { key: StatPeriod; label: string }[] = [
  { key: 'wtd', label: 'Week to Date'  },
  { key: 'mtd', label: 'Month to Date' },
  { key: 'ytd', label: 'Year to Date'  },
];

interface NextSession {
  id: number;
  date: string;
  title: string;
  type: string;
  duration_min: number | null;
  tss_target: number | null;
  description: string | null;
}

interface FeedData {
  recentRides: RecentRide[];
  nextEvent: { id: string; name: string; date: string; goal: string; daysAway: number } | null;
  nextSession: NextSession | null;
  fitness: { ctl: number; atl: number; tsb: number };
  powerHighlights: PowerHighlight[];
  lastCyclingRideId: number | null;
  wtd: PeriodStats | null;
  mtd: PeriodStats | null;
  ytd: PeriodStats | null;
}

function fmt(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m}m`;
}

function relDate(iso: string) {
  const d = new Date(iso);
  const diffH = (Date.now() - d.getTime()) / 3600000;
  if (diffH < 1)  return 'Just now';
  if (diffH < 24) return `${Math.floor(diffH)}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'Yesterday';
  if (diffD < 7)  return `${diffD} days ago`;
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

function timeOfDay(iso: string) {
  return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function LazyMap({ polyline }: { polyline: string }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { rootMargin: '100px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={ref} className="w-full h-44 rounded-xl overflow-hidden bg-gray-800/60">
      {visible && <ActivityMap polyline={polyline} className="w-full h-44" thumbnail />}
    </div>
  );
}

const FEED_CACHE_KEY = 'feed-data-v1';

const SESSION_TYPE_COLOR: Record<string, string> = {
  recovery:   '#34d399',
  endurance:  '#60a5fa',
  tempo:      '#facc15',
  threshold:  '#f97316',
  vo2max:     '#ef4444',
  race:       '#a78bfa',
};

const CACHE_KEY = 'coaching-insight-v1';

function CoachingTip() {
  const cached  = typeof window !== 'undefined' ? localStorage.getItem(CACHE_KEY) ?? '' : '';
  const [tip,     setTip]     = useState(cached);
  const [loading, setLoading] = useState(!cached);
  const fetched = useRef(false);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;

    fetch('/api/coaching-insight')
      .then(r => r.json())
      .then(d => {
        const content = d.content ?? '';
        setTip(content);
        setLoading(false);
        if (content) localStorage.setItem(CACHE_KEY, content);
      })
      .catch(() => { if (!tip) { setTip('Unable to load coaching tip.'); setLoading(false); } });
  }, []);

  return (
    <div className="bg-gray-800/60 rounded-2xl p-4 border border-orange-500/20">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-6 h-6 rounded-full bg-orange-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">C</div>
        <span className="text-xs font-semibold text-orange-400 uppercase tracking-wider">Coaching Insight</span>
      </div>
      {loading ? (
        <div className="space-y-2">
          <div className="h-3 bg-gray-700 rounded animate-pulse w-full" />
          <div className="h-3 bg-gray-700 rounded animate-pulse w-4/5" />
        </div>
      ) : (
        <p className="text-sm text-gray-300 leading-relaxed">{tip}</p>
      )}
      <Link href="/chat" className="mt-3 inline-flex items-center gap-1.5 text-xs text-orange-400 hover:text-orange-300 transition-colors">
        Ask a follow-up
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </Link>
    </div>
  );
}

export default function FeedPage() {
  const [statPeriod, setStatPeriod] = useState<StatPeriod>('wtd');
  const swipeStartX = useRef<number | null>(null);

  function handleStatSwipe(dir: 'left' | 'right') {
    const idx  = STAT_PERIODS.findIndex(p => p.key === statPeriod);
    const next = dir === 'left'
      ? STAT_PERIODS[Math.min(STAT_PERIODS.length - 1, idx + 1)]
      : STAT_PERIODS[Math.max(0, idx - 1)];
    if (next && next.key !== statPeriod) setStatPeriod(next.key);
  }

  const [data, setData] = useState<FeedData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const cached = localStorage.getItem(FEED_CACHE_KEY);
      if (cached) {
        setData(JSON.parse(cached) as FeedData);
        setLoading(false);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetch('/api/analytics/feed')
      .then(r => r.json())
      .then(d => {
        if (!d?.recentRides) { setLoading(false); return; }
        setData(d);
        setLoading(false);
        try { localStorage.setItem(FEED_CACHE_KEY, JSON.stringify(d)); } catch { /* ignore */ }
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading && !data) {
    return (
      <div className="h-full overflow-y-auto scroll-touch">
        <div className="max-w-2xl md:max-w-5xl mx-auto px-4 py-4 md:px-8 md:py-8 space-y-4">
          <div className="h-28 bg-gray-800 rounded-2xl animate-pulse" />
          <div className="h-16 bg-gray-800 rounded-2xl animate-pulse" />
          <div className="h-20 bg-gray-800 rounded-2xl animate-pulse" />
          <div className="h-24 bg-gray-800 rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  const { recentRides = [], nextEvent, nextSession, powerHighlights = [], wtd, mtd, ytd } = data ?? {};
  const activeStat = statPeriod === 'mtd' ? mtd : statPeriod === 'ytd' ? ytd : wtd;
  const newPRs   = powerHighlights.filter(p => p.isNew);

  const sessionColor = nextSession ? (SESSION_TYPE_COLOR[nextSession.type] ?? '#9ca3af') : '#9ca3af';

  // Format session date relative to today
  function sessionDateLabel(dateStr: string) {
    const diff = calendarDaysFromToday(dateStr);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    const [y, m, d] = dateStr.split('-').map(Number);
    if (!y || !m || !d) return dateStr;
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'Australia/Sydney',
    });
  }

  return (
    <div className="h-full overflow-y-auto scroll-touch">
      <div className="max-w-2xl md:max-w-5xl mx-auto px-4 py-4 md:px-8 md:py-8 space-y-3 pb-8">

        {/* ── MOBILE LAYOUT ── */}
        <div className="block md:hidden space-y-3">

          {/* Mobile: Next Session + Event side by side */}
          <div className="flex gap-3 items-stretch">
            <Link
              href="/training?tab=plan"
              className={`flex-1 min-w-0 rounded-2xl p-3 border transition-colors group ${
                nextSession ? 'bg-gray-800/70 border-gray-700/60 hover:border-gray-600' : 'bg-gray-800/40 border-gray-800'
              }`}
            >
              <p className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Next Session</p>
              {nextSession ? (
                <>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span
                      className="px-1.5 py-0.5 rounded text-[9px] font-semibold flex-shrink-0 capitalize"
                      style={{ background: sessionColor + '22', color: sessionColor }}
                    >
                      {nextSession.type}
                    </span>
                    <span className="text-[10px] text-gray-500">{sessionDateLabel(nextSession.date)}</span>
                  </div>
                  <p className="text-xs font-bold text-white group-hover:text-orange-300 transition-colors leading-snug line-clamp-2">
                    {nextSession.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-500">
                    {nextSession.duration_min && <span>{nextSession.duration_min} min</span>}
                    {nextSession.tss_target && <span>{nextSession.tss_target} TSS</span>}
                  </div>
                </>
              ) : (
                <p className="text-xs text-gray-600">No plan active</p>
              )}
            </Link>

            {nextEvent ? (
              <Link
                href={`/events/${nextEvent.id}`}
                className="flex-shrink-0 w-20 rounded-2xl p-2.5 bg-orange-500/10 border border-orange-500/25 hover:border-orange-500/60 hover:bg-orange-500/15 transition-colors flex flex-col items-center justify-center text-center gap-0.5"
              >
                <p className="text-[8px] font-semibold text-orange-400 uppercase tracking-wider">Event</p>
                <p className="text-xl font-black text-orange-400 leading-none">{nextEvent.daysAway}</p>
                <p className="text-[8px] text-orange-400/70">days</p>
                <p className="text-[9px] text-gray-400 font-medium mt-0.5 leading-tight line-clamp-2">{nextEvent.name}</p>
              </Link>
            ) : (
              <div className="flex-shrink-0 w-20 rounded-2xl p-2.5 bg-gray-800/40 border border-gray-800 flex flex-col items-center justify-center text-center">
                <p className="text-[8px] font-semibold text-gray-500 uppercase tracking-wider">Event</p>
                <p className="text-[10px] text-gray-600 mt-1">None</p>
              </div>
            )}
          </div>

          {/* Mobile: Week to Date */}
          <Link
            href="/training"
            className="block bg-gray-800/60 rounded-2xl px-3 py-2.5 border border-transparent hover:border-gray-700 hover:bg-gray-800/80 transition-colors group"
          >
            <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider group-hover:text-orange-400 transition-colors mb-1.5">
              Week to Date →
            </p>
            {activeStat ? (
              <div className="grid grid-cols-5 gap-1">
                {[
                  { label: 'Rides',  value: String(activeStat.rides)     },
                  { label: 'km',     value: String(activeStat.km)        },
                  { label: 'Hours',  value: String(activeStat.hours)     },
                  { label: 'TSS',    value: String(activeStat.tss)       },
                  { label: 'Elev m', value: String(activeStat.elevation) },
                ].map(({ label, value }) => (
                  <div key={label} className="text-center">
                    <p className="text-xs font-bold text-white leading-tight">{value}</p>
                    <p className="text-[9px] text-gray-500 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-6 bg-gray-700/40 rounded animate-pulse" />
            )}
          </Link>
        </div>

        {/* ── DESKTOP LAYOUT ── */}
        <div className="hidden md:grid md:grid-cols-3 gap-3">

          {/* Desktop: Next Training Session */}
          <Link
            href="/training?tab=plan"
            className={`rounded-2xl p-4 border transition-colors group ${
              nextSession ? 'bg-gray-800/70 border-gray-700/60 hover:border-gray-600' : 'bg-gray-800/40 border-gray-800'
            }`}
          >
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Next Session</p>
            {nextSession ? (
              <>
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className="px-2 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 capitalize"
                    style={{ background: sessionColor + '22', color: sessionColor }}
                  >
                    {nextSession.type}
                  </span>
                  <span className="text-[11px] text-gray-500">{sessionDateLabel(nextSession.date)}</span>
                </div>
                <p className="text-sm font-bold text-white group-hover:text-orange-300 transition-colors leading-snug">
                  {nextSession.title}
                </p>
                <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-500">
                  {nextSession.duration_min && <span>{nextSession.duration_min} min</span>}
                  {nextSession.tss_target && <span>{nextSession.tss_target} TSS</span>}
                </div>
                {nextSession.description && (
                  <p className="text-xs text-gray-500 mt-1.5 line-clamp-2 leading-relaxed">
                    {nextSession.description}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-600">No plan active</p>
            )}
          </Link>

          {/* Desktop: Week to Date stats */}
          <Link
            href="/training"
            className="rounded-2xl bg-gray-800/60 px-4 py-4 border border-transparent hover:border-gray-700 hover:bg-gray-800/80 transition-colors group"
          >
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider group-hover:text-orange-400 transition-colors mb-2">
              Week to Date →
            </p>
            {activeStat ? (
              <div className="grid grid-cols-5 gap-1">
                {[
                  { label: 'Rides',  value: String(activeStat.rides)     },
                  { label: 'km',     value: String(activeStat.km)        },
                  { label: 'Hours',  value: String(activeStat.hours)     },
                  { label: 'TSS',    value: String(activeStat.tss)       },
                  { label: 'Elev m', value: String(activeStat.elevation) },
                ].map(({ label, value }) => (
                  <div key={label} className="text-center">
                    <p className="text-sm font-bold text-white leading-tight">{value}</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-8 bg-gray-700/40 rounded animate-pulse" />
            )}
          </Link>

          {/* Desktop: Next Event */}
          {nextEvent ? (
            <Link
              href={`/events/${nextEvent.id}`}
              className="rounded-2xl p-4 bg-orange-500/10 border border-orange-500/25 hover:border-orange-500/60 hover:bg-orange-500/15 transition-colors flex flex-col items-center justify-center text-center gap-0.5"
            >
              <p className="text-[9px] font-semibold text-orange-400 uppercase tracking-wider">Event</p>
              <p className="text-2xl font-black text-orange-400 leading-none">{nextEvent.daysAway}</p>
              <p className="text-[9px] text-orange-400/70">days</p>
              <p className="text-[10px] text-gray-400 font-medium mt-1 leading-tight line-clamp-2">{nextEvent.name}</p>
            </Link>
          ) : (
            <div className="rounded-2xl p-4 bg-gray-800/40 border border-gray-800 flex flex-col items-center justify-center text-center">
              <p className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider">Event</p>
              <p className="text-sm text-gray-600 mt-2">No upcoming events</p>
            </div>
          )}
        </div>

        {/* Coaching Insight */}
        <CoachingTip />

        {/* Row: Readiness & Response + Weekly TSS side by side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ReadinessResponseWidget />

          <Link href="/performance" className="block group">
            <div className="bg-gray-800/60 rounded-2xl border border-transparent hover:border-gray-700 hover:bg-gray-800/80 transition-colors overflow-hidden h-full">
              <div className="px-3 pt-2.5 pb-1">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider group-hover:text-orange-400 transition-colors">Weekly TSS →</p>
              </div>
              <div className="px-1 pb-1">
                <TssRollingChart compact />
              </div>
            </div>
          </Link>
        </div>

        {/* Power PRs */}
        {powerHighlights.length > 0 && (
          <div className="bg-gray-800/60 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
              </svg>
              <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                Last Ride Power
                {newPRs.length > 0 && (
                  <span className="ml-2 px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded text-[10px]">
                    {newPRs.length} NEW PR{newPRs.length > 1 ? 's' : ''}
                  </span>
                )}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {powerHighlights.map(p => (
                <div
                  key={p.seconds}
                  className={`rounded-xl p-3 ${p.isNew ? 'bg-yellow-500/10 border border-yellow-500/30' : 'bg-gray-700/40'}`}
                >
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">{p.label}</p>
                  <p className={`text-lg font-bold ${p.isNew ? 'text-yellow-300' : 'text-white'}`}>{p.watts}W</p>
                  {p.isNew ? (
                    <p className="text-[10px] text-yellow-400 font-semibold">🏆 NEW PR{p.prevBest ? ` (+${p.watts - p.prevBest}W)` : ''}</p>
                  ) : p.prevBest ? (
                    <p className="text-[10px] text-gray-500">Best: {p.prevBest}W</p>
                  ) : null}
                </div>
              ))}
            </div>
            {data?.lastCyclingRideId && (
              <Link
                href={`/activities/${data.lastCyclingRideId}`}
                className="mt-3 inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-orange-400 transition-colors"
              >
                View full ride analysis →
              </Link>
            )}
          </div>
        )}

        {/* Recent rides feed */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Recent Rides</h2>
            <Link href="/dashboard?tab=activities" className="text-xs text-orange-400 hover:text-orange-300 transition-colors">
              All activities →
            </Link>
          </div>

          <div className="space-y-3">
            {recentRides.map(ride => {
              const color    = sportColor(ride.sport_type);
              const np       = ride.normalized_power ?? ride.average_watts;
              const speedKph = ride.average_speed ? (ride.average_speed * 3.6).toFixed(1) : null;

              return (
                <Link
                  key={ride.id}
                  href={`/activities/${ride.id}`}
                  className="block bg-gray-800/60 rounded-2xl overflow-hidden border border-gray-700/40 hover:border-gray-600/60 transition-colors group"
                >
                  <div className="px-4 pt-4 pb-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className="px-2 py-0.5 rounded text-[10px] font-semibold flex-shrink-0"
                            style={{ background: color + '22', color }}
                          >
                            {sportLabel(ride.sport_type)}{ride.trainer ? ' · Indoor' : ''}
                          </span>
                          <span className="text-[11px] text-gray-500 truncate">
                            {relDate(ride.start_date)} · {timeOfDay(ride.start_date)}
                          </span>
                        </div>
                        <h3 className="text-base font-bold text-white group-hover:text-orange-300 transition-colors truncate leading-tight">
                          {ride.name}
                        </h3>
                      </div>
                      <svg className="w-4 h-4 text-gray-600 group-hover:text-orange-400 transition-colors flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap text-sm">
                      {ride.distance > 0 && (
                        <span className="font-semibold text-white">
                          {(ride.distance / 1000).toFixed(1)}<span className="text-xs text-gray-500 ml-0.5">km</span>
                        </span>
                      )}
                      {speedKph && (
                        <span className="text-gray-400">{speedKph}<span className="text-xs ml-0.5">km/h</span></span>
                      )}
                      <span className="text-gray-400">{fmt(ride.moving_time)}</span>
                      {ride.total_elevation_gain > 0 && (
                        <span className="text-gray-400">{Math.round(ride.total_elevation_gain)}<span className="text-xs ml-0.5">m</span></span>
                      )}
                      {np && (
                        <span className="text-gray-300">{Math.round(np)}<span className="text-xs text-gray-500 ml-0.5">W</span></span>
                      )}
                      {ride.tss && (
                        <span className="text-orange-400 text-xs font-medium">{Math.round(ride.tss)} TSS</span>
                      )}
                      {ride.average_heartrate && (
                        <span className="text-red-400 text-xs">♥ {Math.round(ride.average_heartrate)}</span>
                      )}
                    </div>
                  </div>

                  {ride.summary_polyline && (
                    <div className="px-3 pb-3">
                      <LazyMap polyline={ride.summary_polyline} />
                    </div>
                  )}
                </Link>
              );
            })}

            {recentRides.length === 0 && (
              <div className="text-center py-10 text-gray-500 text-sm">No recent rides found.</div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
