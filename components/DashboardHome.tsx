'use client';

import { useEffect, useState } from 'react';
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

function daysUntil(date: Date): number {
  return Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
    </div>
  );
}

function PeriodBlock({ title, stats }: { title: string; stats: PeriodStats }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">{title}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Activities" value={stats.activities} />
        <StatCard label="Distance" value={`${stats.km} km`} />
        <StatCard label="Time" value={`${stats.hours} h`} />
        <StatCard label="TSS" value={stats.tss} />
      </div>
    </div>
  );
}

export default function DashboardHome() {
  const [filter, setFilter] = useState<SportFilter>('All');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/dashboard?filter=${filter}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [filter]);

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

        {/* Activity type filter */}
        <div className="flex gap-2 flex-wrap">
          {SPORT_FILTER_LABELS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-orange-500 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              {f}
            </button>
          ))}
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
            <PeriodBlock title="Week to Date" stats={data.wtd} />
            <PeriodBlock title="Month to Date" stats={data.mtd} />

            <div>
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Year to Date</h3>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <StatCard label="Activities" value={data.ytd.activities} />
                <StatCard label="Distance" value={`${data.ytd.km} km`} />
                <StatCard label="Time" value={`${data.ytd.hours} h`} />
                <StatCard label="TSS" value={data.ytd.tss} />
                <StatCard label="Elevation" value={`${data.ytd.elevation ?? 0} m`} />
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
