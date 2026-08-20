'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ResponsiveContainer, LineChart, Line } from 'recharts';
import { sportLabel, sportColor } from '@/lib/sport-types';
import { useCachedFetch } from '@/lib/use-cached-fetch';
import TssRollingChart from './training/TssRollingChart';
import { calendarDaysFromToday } from '@/lib/calendar-days';
import { CHART } from '@/lib/chart-theme';
import ErrorState from '@/components/ui/ErrorState';
import { formBand } from '@/components/dashboard/FormReading';
import DashboardTop from '@/components/dashboard/DashboardTop';

const ActivityMap = dynamic(() => import('./ActivityMap'), { ssr: false });

export interface RecentRide {
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
  intensity_factor: number | null;
}

interface PowerHighlight {
  label: string;
  seconds: number;
  watts: number;
  prevBest: number | null;
  isNew: boolean;
}

interface PeriodStats { rides: number; km: number; hours: number; tss: number; elevation: number }

export interface NextSession {
  id: number;
  date: string;
  title: string;
  type: string;
  duration_min: number | null;
  tss_target: number | null;
  description: string | null;
}

/** Mirrors the projection in app/api/analytics/feed/route.ts — the route no
 *  longer spreads the whole EventGoal. */
export interface NextEvent {
  id:       string;
  name:     string;
  date:     string;
  goal:     string;
  location: string | null;
  daysAway: number;
}

export interface FeedData {
  recentRides: RecentRide[];
  nextEvent: NextEvent | null;
  nextSession: NextSession | null;
  fitness: { ctl: number; atl: number; tsb: number };
  powerHighlights: PowerHighlight[];
  lastCyclingRideId: number | null;
  wtd: PeriodStats | null;
  mtd: PeriodStats | null;
  ytd: PeriodStats | null;
  eftp: number;
  vo2max: number | null;
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
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
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
    <div ref={ref} className="w-full h-44 rounded-xl overflow-hidden bg-raised/60">
      {visible && <ActivityMap polyline={polyline} className="w-full h-44" thumbnail />}
    </div>
  );
}

// ── Home Progress Widget ──────────────────────────────────────────────────────

interface ProgressResponse {
  current:    { start: string; end: string; total: number; points: { date: string; value: number; cum: number }[] };
  prior:      { start: string; end: string; total: number; points: { date: string; value: number; cum: number }[] };
  fullPeriod: { start: string; end: string; points: { date: string; value: number; cum: number }[] };
  priorFull:  { start: string; end: string; points: { date: string; value: number; cum: number }[] };
}

type ProgressPeriod = 'wtd' | 'mtd' | 'ytd';
const PROGRESS_PERIODS: { key: ProgressPeriod; label: string }[] = [
  { key: 'wtd', label: 'WTD' },
  { key: 'mtd', label: 'MTD' },
  { key: 'ytd', label: 'YTD' },
];
const PRIOR_LABEL: Record<ProgressPeriod, string> = {
  wtd: 'Prior week',
  mtd: 'Prior month',
  ytd: 'Prior year',
};

function fmtHours(h: number) {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  if (hrs === 0) return `${mins}m`;
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

function fmtKm(v: number) {
  return v >= 100 ? `${Math.round(v)} km` : `${v.toFixed(1)} km`;
}

function HomeProgressWidget({ wtd, mtd, ytd }: {
  wtd: PeriodStats | null | undefined;
  mtd: PeriodStats | null | undefined;
  ytd: PeriodStats | null | undefined;
}) {
  const router = useRouter();
  const [period, setPeriod] = useState<ProgressPeriod>('wtd');
  const swipeRef = useRef<number | null>(null);

  const { data: prog, loading: chartLoading } = useCachedFetch<ProgressResponse>(
    `/api/training/progress?period=${period}&metric=km&filters=All&offset=0`,
    `cache-home-progress-${period}`,
  );

  const stats = period === 'mtd' ? mtd : period === 'ytd' ? ytd : wtd;
  const priorTotal = prog?.prior?.total ?? 0;

  // Build chart data from fullPeriod for the x-axis (shows entire period range).
  // Orange line stops at today; grey prior line extends through the full period.
  const fullPts      = prog?.fullPeriod?.points ?? [];
  const curPts       = prog?.current?.points    ?? [];
  const priorFullPts = prog?.priorFull?.points  ?? [];
  const curByDate    = new Map(curPts.map(p => [p.date, p.cum]));
  const chartData = fullPts.map((p, i) => ({
    i,
    current: curByDate.has(p.date) ? curByDate.get(p.date)! : null,
    prior:   priorFullPts[i] != null ? priorFullPts[i].cum : null,
  }));

  function handlePeriodClick(e: React.MouseEvent, p: ProgressPeriod) {
    e.stopPropagation();
    setPeriod(p);
  }

  return (
    <div
      className="bg-raised/60 rounded-2xl border border-transparent hover:border-line-strong hover:bg-raised/80 transition-colors overflow-hidden cursor-pointer"
      onClick={() => router.push('/training?tab=progress')}
      onTouchStart={e => { swipeRef.current = e.touches[0].clientX; }}
      onTouchEnd={e => {
        if (swipeRef.current === null) return;
        const dx = e.changedTouches[0].clientX - swipeRef.current;
        swipeRef.current = null;
        const idx = PROGRESS_PERIODS.findIndex(p => p.key === period);
        if (dx < -40 && idx < PROGRESS_PERIODS.length - 1) setPeriod(PROGRESS_PERIODS[idx + 1].key);
        else if (dx > 40 && idx > 0) setPeriod(PROGRESS_PERIODS[idx - 1].key);
      }}
    >
      <div className="px-3 pt-2.5 pb-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <p className="text-micro font-semibold text-ink-4 uppercase tracking-wider">
            Progress →
          </p>
          <div className="flex gap-0.5">
            {PROGRESS_PERIODS.map(p => (
              <button
                key={p.key}
                onClick={e => handlePeriodClick(e, p.key)}
                className={`px-2 py-0.5 rounded text-micro font-semibold transition-colors ${
                  period === p.key ? 'bg-accent text-ink' : 'text-ink-4 hover:text-ink-2'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-5 gap-1 mb-1">
          {[
            { label: 'Time',       value: stats ? fmtHours(stats.hours) : '—' },
            { label: 'Distance',   value: stats ? fmtKm(stats.km)       : '—' },
            { label: 'TSS',        value: stats ? Math.round(stats.tss).toLocaleString() : '—' },
            { label: 'Elev Gain',  value: stats ? `${Math.round(stats.elevation).toLocaleString()} m` : '—' },
            { label: 'Rides',      value: stats ? String(stats.rides)   : '—' },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-micro text-ink-4">{label}</p>
              <p className="text-mini font-bold text-ink leading-tight">{value}</p>
            </div>
          ))}
        </div>

        {/* Prior period reference */}
        {priorTotal > 0 && !chartLoading && (
          <p className="text-micro text-ink-5 mb-1">
            {PRIOR_LABEL[period]} · {fmtKm(priorTotal)}
          </p>
        )}
      </div>

      {/* Mini line chart — current (orange) vs prior (gray) */}
      <div className="px-1 pb-2">
        {chartLoading ? (
          <div className="h-16 mx-2 animate-pulse bg-hover/30 rounded" />
        ) : (
          <ResponsiveContainer width="100%" height={72}>
            <LineChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <Line type="monotone" dataKey="prior"   stroke={CHART.axisText} strokeWidth={1.5} strokeDasharray="4 2" dot={false} connectNulls />
              <Line type="monotone" dataKey="current" stroke={CHART.power} strokeWidth={2}   dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

/** Shared with DesktopDashboard so the two layouts hit one cache. */
export const FEED_CACHE_KEY = 'cache-feed-v3';   /* v3: nextEvent projected */

const SESSION_TYPE_COLOR: Record<string, string> = {
  recovery:   '#34d399',
  endurance:  '#60a5fa',
  tempo:      '#facc15',
  threshold:  '#f97316',
  vo2max:     '#ef4444',
  race:       '#a78bfa',
};

const CACHE_KEY = 'coaching-insight-v6';

function CoachingTip() {
  const cached  = typeof window !== 'undefined' ? localStorage.getItem(CACHE_KEY) ?? '' : '';
  const [tip,     setTip]     = useState(cached);
  const [loading, setLoading] = useState(!cached);
  const [expanded, setExpanded] = useState(false);
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
    <div className="bg-raised/60 rounded-xl p-3 border border-accent/20">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full text-left flex items-start gap-2.5"
      >
        <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center text-ink text-micro font-bold flex-shrink-0 mt-0.5">C</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-micro font-semibold text-accent-hi uppercase tracking-wider">Coaching Insight</span>
            <svg className={`w-3 h-3 text-ink-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          {loading ? (
            <div className="space-y-1.5">
              <div className="h-3 bg-hover rounded animate-pulse w-full" />
              <div className="h-3 bg-hover rounded animate-pulse w-4/5" />
            </div>
          ) : (
            <p className={`text-xs text-ink-2 leading-snug ${expanded ? '' : 'line-clamp-2'}`}>{tip}</p>
          )}
        </div>
      </button>
      {expanded && !loading && (
        <Link
          href="/chat"
          className="mt-3 ml-8 inline-flex items-center gap-1.5 text-xs font-medium text-accent-hi hover:text-accent-hi transition-colors"
        >
          Open Coach
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      )}
    </div>
  );
}

export default function FeedPage() {
  /* Was a hand-rolled localStorage cache plus two effects, keyed separately
     from the desktop dashboard's — so the same endpoint was cached twice and
     fetched again when the layout switched. Shares FEED_CACHE_KEY with
     DesktopDashboard now, and useCachedFetch brings stale-while-revalidate,
     the 401 redirect and an error state with it. */
  const { data, loading, error, refetch } = useCachedFetch<FeedData>(
    '/api/analytics/feed',
    FEED_CACHE_KEY,
  );

  if (error && !data) {
    return (
      <div className="h-full overflow-y-auto scroll-touch">
        <div className="max-w-2xl md:max-w-5xl xl:max-w-7xl mx-auto px-4 py-4 md:px-8 md:py-8">
          <ErrorState message="Could not load your feed." onRetry={refetch} />
        </div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="h-full overflow-y-auto scroll-touch">
        <div className="max-w-2xl md:max-w-5xl xl:max-w-7xl mx-auto px-4 py-4 md:px-8 md:py-8 space-y-4">
          <div className="h-28 bg-raised rounded-2xl animate-pulse" />
          <div className="h-16 bg-raised rounded-2xl animate-pulse" />
          <div className="h-20 bg-raised rounded-2xl animate-pulse" />
          <div className="h-24 bg-raised rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  const { recentRides = [], nextEvent, nextSession, powerHighlights = [], wtd, mtd, ytd, fitness } = data ?? {};
  const newPRs = powerHighlights.filter(p => p.isNew);

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
      month: 'long',
      year: 'numeric',
      timeZone: 'Australia/Sydney',
    });
  }

  return (
    <div className="h-full overflow-y-auto scroll-touch">
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-3 pb-nav">

        {/* How am I → what today → what's coming. Shared with the desktop
            dashboard so the two orderings cannot drift apart again. */}
        <DashboardTop feed={data} />

        <CoachingTip />

        <HomeProgressWidget wtd={wtd} mtd={mtd} ytd={ytd} />


        {/* Weekly TSS — full width now that TrainingStateStrip has taken over
            from FitnessSummary at the top of the page. */}
        <div>
          <div className="bg-raised/60 rounded-2xl border border-line-strong/40 overflow-hidden h-full">
            <div className="px-3 pt-2.5 pb-1">
              <Link href="/training?tab=progress#weekly-tss" className="inline-flex items-center group">
                <p className="text-micro font-semibold text-ink-4 uppercase tracking-wider group-hover:text-accent-hi transition-colors">Weekly TSS →</p>
              </Link>
            </div>
            <div className="px-1 pb-1">
              <TssRollingChart compact />
            </div>
          </div>
        </div>

        {/* Power PRs */}
        {powerHighlights.length > 0 && (
          <div className="bg-raised/60 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
              </svg>
              <span className="text-xs font-semibold text-ink-2 uppercase tracking-wider">
                Last Ride Power
                {newPRs.length > 0 && (
                  <span className="ml-2 px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded text-micro">
                    {newPRs.length} NEW PR{newPRs.length > 1 ? 's' : ''}
                  </span>
                )}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {powerHighlights.map(p => (
                <div
                  key={p.seconds}
                  className={`rounded-xl p-3 ${p.isNew ? 'bg-yellow-500/10 border border-yellow-500/30' : 'bg-hover/40'}`}
                >
                  <p className="text-micro text-ink-4 uppercase tracking-wider mb-0.5">{p.label}</p>
                  <p className={`text-lg font-bold ${p.isNew ? 'text-yellow-300' : 'text-ink'}`}>{p.watts}W</p>
                  {p.isNew ? (
                    <p className="text-micro text-yellow-400 font-semibold">🏆 NEW PR{p.prevBest ? ` (+${p.watts - p.prevBest}W)` : ''}</p>
                  ) : p.prevBest ? (
                    <p className="text-micro text-ink-4">Best: {p.prevBest}W</p>
                  ) : null}
                </div>
              ))}
            </div>
            {data?.lastCyclingRideId && (
              <Link
                href={`/activities/${data.lastCyclingRideId}`}
                className="mt-3 inline-flex items-center gap-1.5 text-xs text-ink-4 hover:text-accent-hi transition-colors"
              >
                View full ride analysis →
              </Link>
            )}
          </div>
        )}

        {/* Recent rides feed */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-ink-3 uppercase tracking-wider">Recent Rides</h2>
            <Link href="/activities" className="text-xs text-accent-hi hover:text-accent-hi transition-colors">
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
                  className="block bg-raised/60 rounded-2xl overflow-hidden border border-line-strong/40 hover:border-line-hover/60 transition-colors group"
                >
                  <div className="px-4 pt-4 pb-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className="px-2 py-0.5 rounded text-micro font-semibold flex-shrink-0"
                            style={{ background: color + '22', color }}
                          >
                            {sportLabel(ride.sport_type)}{ride.trainer ? ' · Indoor' : ''}
                          </span>
                          <span className="text-mini text-ink-4 truncate">
                            {relDate(ride.start_date)} · {timeOfDay(ride.start_date)}
                          </span>
                        </div>
                        <h3 className="text-base font-bold text-ink group-hover:text-accent-hi transition-colors truncate leading-tight">
                          {ride.name}
                        </h3>
                      </div>
                      <svg className="w-4 h-4 text-ink-5 group-hover:text-accent-hi transition-colors flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap text-sm">
                      {ride.distance > 0 && (
                        <span className="font-semibold text-ink">
                          {(ride.distance / 1000).toFixed(1)}<span className="text-xs text-ink-4 ml-0.5">km</span>
                        </span>
                      )}
                      {speedKph && (
                        <span className="text-ink-3">{speedKph}<span className="text-xs ml-0.5">km/h</span></span>
                      )}
                      <span className="text-ink-3">{fmt(ride.moving_time)}</span>
                      {ride.total_elevation_gain > 0 && (
                        <span className="text-ink-3">{Math.round(ride.total_elevation_gain)}<span className="text-xs ml-0.5">m</span></span>
                      )}
                      {np && (
                        <span className="text-ink-2">{Math.round(np)}<span className="text-xs text-ink-4 ml-0.5">W</span></span>
                      )}
                      {/* Selected in SQL and never rendered until now. */}
                      {ride.intensity_factor != null && ride.intensity_factor > 0 && (
                        <span className="text-ink-3 text-xs">IF {Number(ride.intensity_factor).toFixed(2)}</span>
                      )}
                      {ride.tss && (
                        <span className="text-accent-hi text-xs font-medium">{Math.round(ride.tss)} TSS</span>
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
              <div className="text-center py-10 text-ink-4 text-sm">No recent rides found.</div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
