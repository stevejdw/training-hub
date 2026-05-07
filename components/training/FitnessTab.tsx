'use client';

import { useEffect, useRef, useState } from 'react';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid,
  ReferenceLine, Legend, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useCachedFetch } from '@/lib/use-cached-fetch';

interface FitnessPoint { date: string; atl: number; ctl: number; tsb: number }

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
  const deltaColor = delta > 0 ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-gray-400';

  const weekLabel = data?.current?.start ? fmtWeekRange(data.current.start) : '—';

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Weekly TSS</p>
      </div>

      {/* Totals row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gray-800/60 rounded-lg p-2 text-center">
          <p className="text-[9px] text-gray-500 uppercase tracking-wider">This week</p>
          <p className="text-lg font-bold text-orange-400">{curTotal}</p>
        </div>
        <div className="bg-gray-800/60 rounded-lg p-2 text-center">
          <p className="text-[9px] text-gray-500 uppercase tracking-wider">Prior week</p>
          <p className="text-lg font-bold text-gray-400">{priorTotal}</p>
        </div>
        <div className="bg-gray-800/60 rounded-lg p-2 text-center">
          <p className="text-[9px] text-gray-500 uppercase tracking-wider">Δ</p>
          <p className={`text-lg font-bold ${deltaColor}`}>{delta >= 0 ? '+' : ''}{delta}</p>
        </div>
      </div>

      {/* Bar chart */}
      {loading ? (
        <div className="h-40 animate-pulse bg-gray-800 rounded-lg" />
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={barData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="25%">
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
            <Tooltip
              contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
              formatter={(v, name) => [v, name === 'current' ? 'This week' : 'Prior week']}
            />
            <Legend
              formatter={value => (
                <span style={{ color: '#9ca3af', fontSize: 11 }}>
                  {value === 'current' ? 'This week' : 'Prior week'}
                </span>
              )}
            />
            <Bar dataKey="prior"   fill="#374151" name="prior"   radius={[3,3,0,0]} />
            <Bar dataKey="current" fill="#f97316" name="current" radius={[3,3,0,0]} />
          </BarChart>
        </ResponsiveContainer>
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
          className="p-1.5 rounded text-gray-500 hover:text-white hover:bg-gray-800 transition-colors"
          aria-label="Previous week"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xs text-gray-300 font-medium tabular-nums text-center min-w-[10rem]">{weekLabel}</span>
        <button
          onClick={() => setOffset(o => Math.min(0, o + 1))}
          disabled={offset >= 0}
          className={`p-1.5 rounded transition-colors ${
            offset >= 0 ? 'text-gray-700 cursor-not-allowed' : 'text-gray-500 hover:text-white hover:bg-gray-800'
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
  const [data, setData] = useState<FitnessPoint[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const s = localStorage.getItem(FITNESS_CACHE_KEY(INITIAL_FITNESS_DAYS));
      return s ? JSON.parse(s) : [];
    } catch { return []; }
  });
  const [loading, setLoading] = useState(() => {
    if (typeof window === 'undefined') return true;
    try { return !localStorage.getItem(FITNESS_CACHE_KEY(INITIAL_FITNESS_DAYS)); }
    catch { return true; }
  });
  const [days, setDays] = useState(INITIAL_FITNESS_DAYS);
  const [intervalCreds, setIntervalCreds] = useState<{ id: string; key: string } | null>(null);
  const [wellnessCount, setWellnessCount] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Check if intervals.icu credentials are configured and how much data exists
  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.json())
      .then((p: { intervals_athlete_id?: string; intervals_api_key?: string }) => {
        if (p.intervals_athlete_id && p.intervals_api_key) {
          setIntervalCreds({ id: p.intervals_athlete_id, key: '••••' });
        }
      })
      .catch(() => {});
    fetch('/api/intervals/sync')
      .then(r => r.json())
      .then((d: { total?: number }) => {
        if (d.total) setWellnessCount(d.total);
      })
      .catch(() => {});
  }, []);

  async function triggerSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/intervals/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 7 }),
      });
      const d = await res.json();
      if (d.synced) {
        const s = await fetch('/api/intervals/sync').then(r => r.json());
        setWellnessCount(s.total ?? null);
        // Re-fetch fitness data after sync
        const param = days < 0 ? 'all' : String(days);
        const fr = await fetch(`/api/analytics/fitness?days=${param}`);
        const fd = await fr.json();
        const arr = fd.data ?? [];
        setData(arr);
        try { localStorage.setItem(FITNESS_CACHE_KEY(days), JSON.stringify(arr)); } catch {}
      }
    } catch {}
    setSyncing(false);
  }

  useEffect(() => {
    const cacheKey = FITNESS_CACHE_KEY(days);
    try {
      const s = localStorage.getItem(cacheKey);
      if (s) { setData(JSON.parse(s)); setLoading(false); }
      else setLoading(true);
    } catch { setLoading(true); }

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

  const latest   = data[data.length - 1];
  const tsbColor = (v: number) => v >= 5 ? '#34d399' : v <= -20 ? '#f87171' : '#facc15';
  const tsbLabel = (v: number) => v >= 5 ? 'Fresh' : v <= -20 ? 'Fatigued' : 'Neutral';

  const chartData = data.length > 180
    ? data.filter((_, i) => i % Math.ceil(data.length / 180) === 0).concat(data[data.length - 1])
    : data;

  const fmtDate = (s: string) => {
    const d = new Date(s);
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  };

  return (
    <div className="space-y-5">

      {/* CTL / ATL / TSB snapshot */}
      {latest && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gray-800/60 rounded-xl p-3 text-center">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Fitness (CTL)</p>
            <p className="text-2xl font-bold text-blue-400">{latest.ctl}</p>
          </div>
          <div className="bg-gray-800/60 rounded-xl p-3 text-center">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Fatigue (ATL)</p>
            <p className="text-2xl font-bold text-purple-400">{latest.atl}</p>
          </div>
          <div className="bg-gray-800/60 rounded-xl p-3 text-center">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Form (TSB)</p>
            <p className="text-2xl font-bold" style={{ color: tsbColor(latest.tsb) }}>
              {latest.tsb > 0 ? '+' : ''}{latest.tsb}
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: tsbColor(latest.tsb) }}>
              {tsbLabel(latest.tsb)}
            </p>
          </div>
        </div>
      )}

      {/* Range selector — 'all' uses a sentinel value (-1) for "All time" */}
      <div className="flex gap-1.5 flex-wrap">
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
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              days === d
                ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                : 'bg-gray-800 text-gray-500 hover:text-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Data source indicator */}
      <div className="flex items-center justify-between">
        {(intervalCreds || syncing) && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">Data source:</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 font-medium">
              <svg className="w-3 h-3 text-orange-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
              </svg>
              intervals.icu{wellnessCount ? ` · ${wellnessCount} days` : ''}
            </span>
            <button
              onClick={triggerSync}
              disabled={syncing}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-gray-500 hover:text-white hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              {syncing ? (
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" strokeOpacity={0.25} />
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              Sync
            </button>
          </div>
        )}
        {!intervalCreds && !syncing && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">Data source:</span>
            <span className="text-[11px] text-gray-500">Strava TSS</span>
            <a
              href="/settings"
              className="text-[10px] text-orange-400 hover:text-orange-300 transition-colors underline"
            >
              Connect intervals.icu
            </a>
          </div>
        )}
      </div>

      {/* CTL / ATL / TSB chart */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">ATL · CTL · Form (TSB)</p>
        {loading ? (
          <div className="h-64 animate-pulse bg-gray-800 rounded-lg" />
        ) : chartData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-gray-500 text-sm">No TSS data found</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={fmtDate}
                tick={{ fill: '#6b7280', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: '#6b7280', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={32}
              />
              <ReferenceLine y={0} stroke="#374151" strokeDasharray="3 3" />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                labelFormatter={(s: any) => fmtDate(String(s))}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(val: any, name: any) => {
                  const labels: Record<string, string> = { ctl: 'Fitness (CTL)', atl: 'Fatigue (ATL)', tsb: 'Form (TSB)' };
                  const n = Number(val);
                  return [n > 0 ? `+${n}` : n, labels[String(name)] ?? String(name)];
                }}
              />
              <Legend
                formatter={(value) => {
                  const labels: Record<string, string> = { ctl: 'Fitness (CTL)', atl: 'Fatigue (ATL)', tsb: 'Form (TSB)' };
                  return <span style={{ color: '#9ca3af', fontSize: 11 }}>{labels[value] ?? value}</span>;
                }}
              />
              <Line type="monotone" dataKey="ctl" stroke="#60a5fa" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="atl" stroke="#c084fc" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="tsb" stroke="#34d399" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Legend explainer */}
      <div className="grid grid-cols-3 gap-2 text-xs text-gray-500">
        <div><span className="text-blue-400 font-medium">CTL</span> — Chronic Training Load (42d avg). Your fitness base.</div>
        <div><span className="text-purple-400 font-medium">ATL</span> — Acute Training Load (7d avg). Recent fatigue.</div>
        <div><span className="text-green-400 font-medium">TSB</span> — Form = CTL − ATL. Positive = fresh, negative = tired.</div>
      </div>

    </div>
  );
}
