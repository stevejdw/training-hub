'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SPORT_FILTER_LABELS, SportFilter } from '@/lib/sport-types';

interface PeriodStats {
  activities: string;
  km: string;
  hours: string;
  tss: string;
  elevation?: string;
}

interface DashboardData {
  mtd: PeriodStats;
  wtd: PeriodStats;
  ytd: PeriodStats;
}

const TARGET_EVENT = new Date('2026-05-02');
const PEAKS_2027 = new Date('2027-03-01');

const TYPE_FILTERS = SPORT_FILTER_LABELS.filter(f => f !== 'All') as SportFilter[];

function daysUntil(date: Date): number {
  return Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

// Returns ISO date string for start of current week (Monday), month, year in Sydney time
function periodStart(period: 'wtd' | 'mtd' | 'ytd'): string {
  const now = new Date(new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' }));
  if (period === 'wtd') {
    const day = now.getDay(); // 0=Sun
    const diff = (day === 0 ? -6 : 1 - day);
    now.setDate(now.getDate() + diff);
  } else if (period === 'mtd') {
    now.setDate(1);
  } else {
    now.setMonth(0, 1);
  }
  return now.toISOString().slice(0, 10);
}

function StatCard({
  label,
  value,
  href,
}: {
  label: string;
  value: string | number;
  href?: string;
}) {
  const inner = (
    <div className={`bg-gray-800 rounded-xl p-4 h-full ${href ? 'hover:bg-gray-700 transition-colors cursor-pointer' : ''}`}>
      <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
      {href && <div className="text-xs text-orange-500 mt-1">View →</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : <div>{inner}</div>;
}

function PeriodBlock({
  title,
  stats,
  filtersParam,
  period,
}: {
  title: string;
  stats: PeriodStats;
  filtersParam: string;
  period: 'wtd' | 'mtd' | 'ytd';
}) {
  const from = periodStart(period);
  const base = filtersParam !== 'All'
    ? `/activities?filters=${filtersParam}&from=${from}`
    : `/activities?from=${from}`;

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">{title}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Activities" value={stats.activities} href={base} />
        <StatCard label="Distance" value={`${stats.km} km`} href={base} />
        <StatCard label="Time" value={`${stats.hours} h`} href={base} />
        <StatCard label="TSS" value={stats.tss} href={base} />
      </div>
    </div>
  );
}

export default function DashboardHome() {
  const [selected, setSelected] = useState<Set<SportFilter>>(new Set());
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  function toggleFilter(f: SportFilter) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(f) ? next.delete(f) : next.add(f);
      return next;
    });
  }

  const filtersParam = selected.size > 0 ? [...selected].join(',') : 'All';

  useEffect(() => {
    setLoading(true);
    fetch(`/api/dashboard?filters=${filtersParam}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [filtersParam]);

  const daysToEvent = daysUntil(TARGET_EVENT);
  const daysToPeaks = daysUntil(PEAKS_2027);

  return (
    <div className="h-[calc(100vh-64px)] overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">

        {/* Event countdowns */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4">
            <div className="text-xs text-orange-400 uppercase tracking-wider mb-1">Target Event</div>
            <div className="text-2xl font-bold text-orange-400">{daysToEvent}d</div>
            <div className="text-xs text-gray-400 mt-0.5">May 2 2026</div>
          </div>
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
            <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Peaks Challenge 2027</div>
            <div className="text-2xl font-bold text-gray-300">{daysToPeaks}d</div>
            <div className="text-xs text-gray-500 mt-0.5">Target: sub 8:30</div>
          </div>
        </div>

        {/* Multi-select filter */}
        <div className="flex gap-2 flex-wrap items-center">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => toggleFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                selected.has(f)
                  ? 'bg-orange-500 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              {f}
            </button>
          ))}
          {selected.size > 0 && (
            <button
              onClick={() => setSelected(new Set())}
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-500 hover:text-white transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {loading ? (
          <div className="space-y-8">
            {[1, 2, 3].map((i) => (
              <div key={i} className="grid grid-cols-4 gap-3">
                {[1, 2, 3, 4].map((j) => (
                  <div key={j} className="bg-gray-800 rounded-xl p-4 h-20 animate-pulse" />
                ))}
              </div>
            ))}
          </div>
        ) : data ? (
          <>
            <PeriodBlock title="Week to Date" stats={data.wtd} filtersParam={filtersParam} period="wtd" />
            <PeriodBlock title="Month to Date" stats={data.mtd} filtersParam={filtersParam} period="mtd" />

            {/* YTD */}
            <div>
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Year to Date</h3>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {(() => {
                  const from = periodStart('ytd');
                  const base = filtersParam !== 'All'
                    ? `/activities?filters=${filtersParam}&from=${from}`
                    : `/activities?from=${from}`;
                  return <>
                    <StatCard label="Activities" value={data.ytd.activities} href={base} />
                    <StatCard label="Distance" value={`${data.ytd.km} km`} href={base} />
                    <StatCard label="Time" value={`${data.ytd.hours} h`} href={base} />
                    <StatCard label="TSS" value={data.ytd.tss} href={base} />
                    <StatCard label="Elevation" value={`${data.ytd.elevation ?? 0} m`} href={base} />
                  </>;
                })()}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
