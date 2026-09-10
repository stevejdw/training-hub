'use client';

import { useEffect, useRef, useState } from 'react';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid,
  Legend, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useCachedFetch } from '@/lib/use-cached-fetch';
import EnlargeableChart from '@/components/EnlargeableChart';
import FitnessChart, { type FitnessPoint } from './FitnessChart';
import { CHART } from '@/lib/chart-theme';
import { formBand } from '@/components/dashboard/FormReading';
interface EftpPoint  { date: string; eftp: number }
interface Vo2Point   { date: string; vo2max: number; source?: 'garmin' | 'estimated' }
interface EftpHistoryResponse { eftpPoints: EftpPoint[]; vo2Points: Vo2Point[]; weight: number | null; vo2GarminFrom?: string | null }

type ChartPeriod = '3m' | '6m' | '1y';
const CHART_PERIODS: { key: ChartPeriod; label: string; days: number }[] = [
  { key: '3m', label: '3m', days: 90  },
  { key: '6m', label: '6m', days: 180 },
  { key: '1y', label: '1y', days: 365 },
];

function getWindow<T extends { date: string }>(allPoints: T[], period: ChartPeriod, offset: number): T[] {
  if (allPoints.length === 0) return allPoints;
  const periodDays = CHART_PERIODS.find(p => p.key === period)!.days;
  const endMs   = Date.now() - offset * periodDays * 86400000;
  const startMs = endMs - periodDays * 86400000;
  const endDate   = new Date(endMs).toISOString().slice(0, 10);
  const startDate = new Date(startMs).toISOString().slice(0, 10);
  return allPoints.filter(p => p.date >= startDate && p.date <= endDate);
}

function canGoBack<T extends { date: string }>(allPoints: T[], period: ChartPeriod, offset: number): boolean {
  const periodDays  = CHART_PERIODS.find(p => p.key === period)!.days;
  const windowStart = new Date(Date.now() - (offset + 1) * periodDays * 86400000).toISOString().slice(0, 10);
  return allPoints.some(p => p.date < windowStart);
}

interface ChartNavProps {
  period:   ChartPeriod;
  offset:   number;
  hasBack:  boolean;
  setPeriod:(p: ChartPeriod) => void;
  setOffset:(fn: (o: number) => number) => void;
}

function ChartNav({ period, offset, hasBack, setPeriod, setOffset }: ChartNavProps) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex bg-raised rounded-lg p-0.5 gap-0.5">
        {CHART_PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => { setPeriod(p.key); setOffset(() => 0); }}
            className={`px-2 py-1 rounded-md text-micro font-medium transition-colors ${
              period === p.key ? 'bg-accent text-ink' : 'text-ink-3 hover:text-ink'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <button onClick={() => setOffset(o => o + 1)} disabled={!hasBack}
        className="p-1 rounded-lg bg-raised text-ink-3 hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <button onClick={() => setOffset(o => Math.max(0, o - 1))} disabled={offset === 0}
        className="p-1 rounded-lg bg-raised text-ink-3 hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}

const MAX_CHART_POINTS = 8;

function evenSample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const step = (arr.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => arr[Math.round(i * step)]);
}

// eFTP: monthly max (highest FTP reading per month), capped at 8 points
function reduceEftpPoints(points: EftpPoint[]): EftpPoint[] {
  if (points.length === 0) return [];
  const byMonth = new Map<string, EftpPoint>();
  for (const p of points) {
    const month = p.date.slice(0, 7);
    const existing = byMonth.get(month);
    if (!existing || p.eftp > existing.eftp) byMonth.set(month, p);
  }
  const monthly = Array.from(byMonth.values()).sort((a, b) => a.date.localeCompare(b.date));
  return evenSample(monthly, MAX_CHART_POINTS);
}

// VO2 varies per ride — monthly max then cap at 8
function reduceVo2Points(points: Vo2Point[]): Vo2Point[] {
  if (points.length === 0) return [];
  const byMonth = new Map<string, Vo2Point>();
  for (const p of points) {
    const month = p.date.slice(0, 7);
    const existing = byMonth.get(month);
    if (!existing || p.vo2max > existing.vo2max) byMonth.set(month, p);
  }
  const monthly = Array.from(byMonth.values()).sort((a, b) => a.date.localeCompare(b.date));
  return evenSample(monthly, MAX_CHART_POINTS);
}

const FITNESS_CACHE_KEY = (d: number) => `cache-fitness-${d}`;
const INITIAL_FITNESS_DAYS = 90;

// ─── Weekly TSS chart ─────────────────────────────────────────────────────────
interface DayPoint { date: string; value: number; cum: number }
interface ProgressResponse {
  current: { start: string; end: string; total: number; points: DayPoint[] };
  prior:   { start: string; end: string; total: number; points: DayPoint[] };
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function fmtWeekRange(start: string): string {
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [sy, sm, sd] = start.split('-').map(Number);
  const endDate = new Date(Date.UTC(sy, sm - 1, sd + 6));
  const ed = endDate.getUTCDate(), em = endDate.getUTCMonth();
  const ey = endDate.getUTCFullYear();
  if (sm - 1 === em && sy === ey) return `${M[sm-1]} ${sd}–${ed}`;
  return `${M[sm-1]} ${sd} – ${M[em]} ${ed}`;
}

export function TssWeekChart() {
  const [offset, setOffset] = useState(0);
  const swipeRef = useRef<number | null>(null);

  const qs = `period=wtd&metric=tss&filters=All&offset=${offset}`;
  const { data, loading } = useCachedFetch<ProgressResponse>(
    `/api/training/progress?${qs}`,
    `cache-tss-week-${qs}`,
  );

  const barData = DAYS.map((label, i) => ({
    label,
    current: Math.round(data?.current?.points[i]?.value ?? 0),
    prior:   Math.round(data?.prior?.points[i]?.value   ?? 0),
  }));

  const curTotal   = Math.round(data?.current?.total ?? 0);
  const priorTotal = Math.round(data?.prior?.total   ?? 0);
  const delta      = curTotal - priorTotal;
  const deltaColor = delta > 0 ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-ink-3';

  const weekLabel = data?.current?.start ? fmtWeekRange(data.current.start) : '—';

  return (
    <div className="bg-surface rounded-xl border border-line p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-ink-4 uppercase tracking-wider">Weekly TSS</p>
      </div>

      {/* Totals row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-raised/60 rounded-lg p-2 text-center">
          <p className="text-micro text-ink-4 uppercase tracking-wider">This week</p>
          <p className="text-lg font-bold text-accent-hi">{curTotal}</p>
        </div>
        <div className="bg-raised/60 rounded-lg p-2 text-center">
          <p className="text-micro text-ink-4 uppercase tracking-wider">Prior week</p>
          <p className="text-lg font-bold text-ink-3">{priorTotal}</p>
        </div>
        <div className="bg-raised/60 rounded-lg p-2 text-center">
          <p className="text-micro text-ink-4 uppercase tracking-wider">Δ</p>
          <p className={`text-lg font-bold ${deltaColor}`}>{delta >= 0 ? '+' : ''}{delta}</p>
        </div>
      </div>

      {/* Bar chart */}
      {loading ? (
        <div className="h-40 animate-pulse bg-raised rounded-lg" />
      ) : (
        <EnlargeableChart title="Weekly TSS" controls={
          <div className="flex items-center gap-1.5 select-none">
            <button
              onClick={() => setOffset(o => o - 1)}
              className="p-1 rounded bg-raised text-ink-3 hover:text-ink transition-colors"
              aria-label="Previous week"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-micro text-ink-2 font-medium tabular-nums text-center min-w-[5.5rem]">{weekLabel}</span>
            <button
              onClick={() => setOffset(o => Math.min(0, o + 1))}
              disabled={offset >= 0}
              className={`p-1 rounded bg-raised transition-colors ${
                offset >= 0 ? 'text-ink-5 cursor-not-allowed' : 'text-ink-3 hover:text-ink'
              }`}
              aria-label="Next week"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        }>{(fs) => (
        <ResponsiveContainer width="100%" height={fs ? '100%' : 160}>
          <BarChart data={barData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="25%">
            <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: CHART.axisText, fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: CHART.axisText, fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
            <Tooltip
              contentStyle={{ background: CHART.tooltipBg, border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
              formatter={(v, name) => [v, name === 'current' ? 'This week' : 'Prior week']}
            />
            <Legend
              formatter={value => (
                <span style={{ color: CHART.reference, fontSize: 11 }}>
                  {value === 'current' ? 'This week' : 'Prior week'}
                </span>
              )}
            />
            <Bar dataKey="prior"   fill={CHART.axis} name="prior"   radius={[3,3,0,0]} />
            <Bar dataKey="current" fill={CHART.power} name="current" radius={[3,3,0,0]} />
          </BarChart>
        </ResponsiveContainer>
        )}</EnlargeableChart>
      )}

      {/* Week navigation — below the chart, arrows on sides with date range between */}
      <div
        className="flex items-center justify-center gap-4 select-none"
        onTouchStart={e => { swipeRef.current = e.touches[0].clientX; }}
        onTouchEnd={e => {
          if (swipeRef.current === null) return;
          const dx = e.changedTouches[0].clientX - swipeRef.current;
          swipeRef.current = null;
          if (dx < -40) setOffset(o => o - 1);          // swipe left → older
          else if (dx > 40) setOffset(o => Math.min(0, o + 1)); // swipe right → newer
        }}
      >
        <button
          onClick={() => setOffset(o => o - 1)}
          className="p-1.5 rounded text-ink-4 hover:text-ink hover:bg-raised transition-colors"
          aria-label="Previous week"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xs text-ink-2 font-medium tabular-nums text-center min-w-[10rem]">{weekLabel}</span>
        <button
          onClick={() => setOffset(o => Math.min(0, o + 1))}
          disabled={offset >= 0}
          className={`p-1.5 rounded transition-colors ${
            offset >= 0 ? 'text-ink-5 cursor-not-allowed' : 'text-ink-4 hover:text-ink hover:bg-raised'
          }`}
          aria-label="Next week"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default function FitnessTab() {
  // Initial state must match SSR output — the [days] effect below restores
  // the localStorage cache immediately after mount, so hydration stays clean.
  const [data, setData] = useState<FitnessPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(INITIAL_FITNESS_DAYS);

  useEffect(() => {

    const cacheKey = FITNESS_CACHE_KEY(days);
    // Stale-while-revalidate: keep showing existing data while the new window
    // loads, so changing range doesn't tear down an open fullscreen chart.
    // Only show the skeleton when there's nothing to display yet.
    try {
      const s = localStorage.getItem(cacheKey);
      if (s) { setData(JSON.parse(s)); setLoading(false); }
      else setData(cur => { setLoading(cur.length === 0); return cur; });
    } catch {
      setData(cur => { setLoading(cur.length === 0); return cur; });
    }

    const param = days < 0 ? 'all' : String(days);
    fetch(`/api/analytics/fitness?days=${param}`)
      .then(r => r.json())
      .then(d => {
        const arr = d.data ?? [];
        setData(arr);
        setLoading(false);
        try { localStorage.setItem(cacheKey, JSON.stringify(arr)); } catch {}
      })
      .catch(() => setLoading(false));
  }, [days]);

  const { data: eftpData, loading: eftpLoading } = useCachedFetch<EftpHistoryResponse>(
    '/api/analytics/eftp-history',
    'cache-eftp-history-v8',
  );

  const [eftpPeriod, setEftpPeriod] = useState<ChartPeriod>('6m');
  const [eftpOffset, setEftpOffset] = useState(0);
  const [vo2Period,  setVo2Period]  = useState<ChartPeriod>('6m');
  const [vo2Offset,  setVo2Offset]  = useState(0);

  const allEftpPoints = eftpData?.eftpPoints ?? [];
  const allVo2Points  = eftpData?.vo2Points  ?? [];
  const vo2GarminFrom = eftpData?.vo2GarminFrom ?? null;

  const windowEftp = getWindow(allEftpPoints, eftpPeriod, eftpOffset);
  const eftpPoints = reduceEftpPoints(windowEftp);

  const windowVo2 = getWindow(allVo2Points, vo2Period, vo2Offset);
  const vo2Points = reduceVo2Points(windowVo2);

  const fmtTick = (s: string, period: ChartPeriod) => {
    const d = new Date(s + 'T00:00:00');
    if (period === '1y') return d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' });
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  };

  const latest = data[data.length - 1];
  /* formBand, not a local three-band scale. This file used to call -21.8
     "Fatigued" while the dashboard called the same number "Building" — same
     metric, two vocabularies and two sets of thresholds. One table now. */
  const band = latest ? formBand(latest.tsb) : null;

  const fmtDate = (s: string) => {
    const d = new Date(s);
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  return (
    <div className="space-y-5">

      {/* CTL / ATL / TSB snapshot */}
      {latest && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-raised/60 rounded-xl p-3 text-center">
            <p className="text-micro text-ink-4 uppercase tracking-wider mb-1">Fitness (CTL)</p>
            <p className="text-2xl font-bold text-blue-400">{latest.ctl}</p>
          </div>
          <div className="bg-raised/60 rounded-xl p-3 text-center">
            <p className="text-micro text-ink-4 uppercase tracking-wider mb-1">Fatigue (ATL)</p>
            <p className="text-2xl font-bold text-purple-400">{latest.atl}</p>
          </div>
          <div className="bg-raised/60 rounded-xl p-3 text-center">
            <p className="text-micro text-ink-4 uppercase tracking-wider mb-1">Form (TSB)</p>
            <p className="text-2xl font-bold" style={{ color: band!.color }}>
              {latest.tsb > 0 ? '+' : ''}{latest.tsb}
            </p>
            <p className="text-micro mt-0.5" style={{ color: band!.color }}>
              {band!.label}
            </p>
          </div>
        </div>
      )}

      {/* Range selector — 'all' uses a sentinel value (-1) for "All time".
          Scrolls rather than wraps: five chips wrapped to a second line on a
          375px screen, pushing the chart further down a page that already
          had too little of it above the fold. */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-none -mx-4 px-4">
        {[
          { d: 30,   label: '30 days'  },
          { d: 90,   label: '90 days'  },
          { d: 180,  label: '6 months' },
          { d: 365,  label: '1 year'   },
          { d: -1,   label: 'All time' },
        ].map(({ d, label }) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`flex-shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              days === d
                ? 'bg-accent/20 text-accent-hi border border-accent/50'
                : 'bg-raised text-ink-4 hover:text-ink-2'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* CTL / ATL / TSB chart */}

      <div className="bg-surface rounded-xl border border-line p-4">
        <p className="text-xs font-semibold text-ink-4 uppercase tracking-wider mb-4">ATL · CTL · Form (TSB)</p>
        <FitnessChart data={data} loading={loading} days={days} setDays={setDays} />
      </div>

      {/* Legend explainer */}
      <div className="grid grid-cols-3 gap-2 text-xs text-ink-4">
        <div><span className="text-blue-400 font-medium">CTL</span> — Chronic Training Load (42d avg). Your fitness base.</div>
        <div><span className="text-purple-400 font-medium">ATL</span> — Acute Training Load (7d avg). Recent fatigue.</div>
        <div><span className="text-green-400 font-medium">TSB</span> — Form = CTL − ATL. Positive = fresh, negative = tired.</div>
      </div>

      {/* eFTP trend */}
      <div className="bg-surface rounded-xl border border-line p-4">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold text-ink-4 uppercase tracking-wider">Estimated FTP (eFTP)</p>
          <ChartNav
            period={eftpPeriod} offset={eftpOffset}
            hasBack={canGoBack(allEftpPoints, eftpPeriod, eftpOffset)}
            setPeriod={setEftpPeriod} setOffset={setEftpOffset}
          />
        </div>
        {eftpLoading ? (
          <div className="h-48 animate-pulse bg-raised rounded-lg" />
        ) : !eftpPoints.length ? (
          <div className="h-48 flex items-center justify-center text-ink-4 text-sm">No data for this period</div>
        ) : (
          <EnlargeableChart title="Estimated FTP (eFTP)" controls={
            <ChartNav
              period={eftpPeriod} offset={eftpOffset}
              hasBack={canGoBack(allEftpPoints, eftpPeriod, eftpOffset)}
              setPeriod={setEftpPeriod} setOffset={setEftpOffset}
            />
          }>{(fs) => (
          <ResponsiveContainer width="100%" height={fs ? '100%' : 200}>
            <LineChart data={eftpPoints} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="date" tickFormatter={s => fmtTick(s, eftpPeriod)}
                tick={{ fill: CHART.axisText, fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: CHART.axisText, fontSize: 10 }} axisLine={false} tickLine={false} width={36}
                domain={[(min: number) => Math.round(min - 15), (max: number) => Math.round(max + 10)]} />
              <Tooltip contentStyle={{ background: CHART.tooltipBg, border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                labelFormatter={s => fmtDate(String(s))} formatter={val => [`${val}w`, 'eFTP']} />
              <Line type="monotone" dataKey="eftp" stroke={CHART.power} strokeWidth={2} dot={{ fill: CHART.power, r: 3 }} activeDot={{ r: 5 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
          )}</EnlargeableChart>
        )}
        <p className="text-micro text-ink-5 mt-2">
          Best power over a rolling 42 days, converted with the Coggan multipliers
          (5 min ×0.78, 10 min ×0.87, 20 min ×0.95, 60 min ×1.00) and the highest kept.
          Independent of the FTP set in your profile.
        </p>
      </div>

      {/* VO₂ Max trend — only when weight is configured */}
      {eftpData?.weight != null && (
        <div className="bg-surface rounded-xl border border-line p-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold text-ink-4 uppercase tracking-wider">VO₂ Max</p>
            <ChartNav
              period={vo2Period} offset={vo2Offset}
              hasBack={canGoBack(allVo2Points, vo2Period, vo2Offset)}
              setPeriod={setVo2Period} setOffset={setVo2Offset}
            />
          </div>
          {eftpLoading ? (
            <div className="h-48 animate-pulse bg-raised rounded-lg" />
          ) : !vo2Points.length ? (
            <div className="h-48 flex items-center justify-center text-ink-4 text-sm">No data for this period</div>
          ) : (
            <EnlargeableChart title="VO₂ Max" controls={
              <ChartNav
                period={vo2Period} offset={vo2Offset}
                hasBack={canGoBack(allVo2Points, vo2Period, vo2Offset)}
                setPeriod={setVo2Period} setOffset={setVo2Offset}
              />
            }>{(fs) => (
            <ResponsiveContainer width="100%" height={fs ? '100%' : 200}>
              <LineChart data={vo2Points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="date" tickFormatter={s => fmtTick(s, vo2Period)}
                  tick={{ fill: CHART.axisText, fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: CHART.axisText, fontSize: 10 }} axisLine={false} tickLine={false} width={36}
                  domain={[(min: number) => Math.round(min - 2), (max: number) => Math.round(max + 2)]} />
                <Tooltip contentStyle={{ background: CHART.tooltipBg, border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                  labelFormatter={s => fmtDate(String(s))} formatter={val => [`${val} ml/kg/min`, 'VO₂ Max']} />
                <Line type="monotone" dataKey="vo2max" stroke="#2dd4bf" strokeWidth={2} dot={{ fill: '#2dd4bf', r: 3 }} activeDot={{ r: 5 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
            )}</EnlargeableChart>
          )}
          <p className="text-micro text-ink-5 mt-2">
            {vo2GarminFrom
              ? <>Garmin cycling VO₂ max from {fmtDate(vo2GarminFrom)}. Earlier points are estimated from best 5-min power (10.8 × W/kg + 7).</>
              : <>Estimated from best 5-min power (10.8 × W/kg + 7) — no Garmin VO₂ max synced yet.</>}
          </p>
        </div>
      )}

    </div>
  );
}
