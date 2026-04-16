'use client';

import { useEffect, useState } from 'react';
import { SPORT_FILTER_LABELS, SportFilter } from '@/lib/sport-types';
import PowerCurveChart from './PowerCurveChart';

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
  powerCurve: { label: string; power: number }[];
  powerCurveCompare: { label: string; power: number }[] | null;
  compareLabel: string;
  eFTP: number;
}

type Period = '30d' | '90d' | '365d' | 'all';
type Compare = 'none' | 'prev' | 'year';

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

function FilterPill<T extends string>({
  options,
  value,
  onChange,
  labelMap,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labelMap?: Record<string, string>;
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            value === opt
              ? 'bg-orange-500 text-white'
              : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
          }`}
        >
          {labelMap?.[opt] ?? opt}
        </button>
      ))}
    </div>
  );
}

const PERIODS: Period[] = ['30d', '90d', '365d', 'all'];
const PERIOD_LABELS: Record<string, string> = { '30d': '30d', '90d': '90d', '365d': '1yr', all: 'All' };
const COMPARES: Compare[] = ['none', 'prev', 'year'];
const COMPARE_LABELS: Record<string, string> = { none: 'Compare', prev: 'Prev period', year: '1yr ago' };

export default function DashboardHome() {
  const [filter, setFilter] = useState<SportFilter>('All');
  const [period, setPeriod] = useState<Period>('90d');
  const [compare, setCompare] = useState<Compare>('none');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/dashboard?filter=${filter}&period=${period}&compare=${compare}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [filter, period, compare]);

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
        <FilterPill options={SPORT_FILTER_LABELS} value={filter} onChange={setFilter} />

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

            {/* YTD */}
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

            {/* Power Curve */}
            <div>
              <div className="flex items-start justify-between mb-3 gap-4 flex-wrap">
                <div>
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Power Curve</h3>
                  {data.eFTP > 0 && (
                    <span className="text-xs text-orange-400 mt-0.5 block">eFTP {data.eFTP}W · FTP 340W</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {/* Period filter */}
                  <FilterPill options={PERIODS} value={period} onChange={setPeriod} labelMap={PERIOD_LABELS} />
                  {/* Compare */}
                  <div className="flex gap-1.5">
                    {COMPARES.filter((c) => c !== 'none').map((c) => (
                      <button
                        key={c}
                        onClick={() => setCompare(compare === c ? 'none' : c)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                          compare === c
                            ? 'bg-gray-600 border-gray-500 text-white'
                            : 'bg-transparent border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'
                        }`}
                      >
                        {COMPARE_LABELS[c]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <PowerCurveChart
                data={data.powerCurve}
                compareData={data.powerCurveCompare}
                compareLabel={data.compareLabel}
                ftp={340}
              />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
