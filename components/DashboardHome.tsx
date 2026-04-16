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

const TYPE_FILTERS = SPORT_FILTER_LABELS.filter(f => f !== 'All') as SportFilter[];

// Reliable Sydney-aware date for period start
function periodStart(period: 'wtd' | 'mtd' | 'ytd'): string {
  // Sydney is UTC+10 (AEST) or UTC+11 (AEDT). Use +10 as safe floor.
  const sydneyNow = new Date(Date.now() + 10 * 60 * 60 * 1000);
  const y = sydneyNow.getUTCFullYear();
  const m = sydneyNow.getUTCMonth();
  const d = sydneyNow.getUTCDate();
  const dow = sydneyNow.getUTCDay(); // 0=Sun

  if (period === 'wtd') {
    const daysFromMon = dow === 0 ? 6 : dow - 1;
    const mon = new Date(Date.UTC(y, m, d - daysFromMon));
    return mon.toISOString().slice(0, 10);
  }
  if (period === 'mtd') return `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return `${y}-01-01`;
}

function StatCard({ label, value, href }: { label: string; value: string | number; href?: string }) {
  const inner = (
    <div className={`bg-gray-800 rounded-xl p-4 h-full ${href ? 'hover:bg-gray-700 transition-colors cursor-pointer' : ''}`}>
      <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
    </div>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : <div>{inner}</div>;
}

function PeriodBlock({ title, stats, filtersParam, period }: {
  title: string;
  stats: PeriodStats;
  filtersParam: string;
  period: 'wtd' | 'mtd' | 'ytd';
}) {
  const from = periodStart(period);
  const qs = [
    filtersParam !== 'All' ? `filters=${encodeURIComponent(filtersParam)}` : '',
    `from=${from}`,
  ].filter(Boolean).join('&');
  const href = `/activities?${qs}`;

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">{title}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Activities" value={stats.activities ?? 0} href={href} />
        <StatCard label="Distance" value={`${stats.km ?? 0} km`} href={href} />
        <StatCard label="Time" value={`${stats.hours ?? 0} h`} href={href} />
        <StatCard label="TSS" value={stats.tss ?? 0} href={href} />
      </div>
    </div>
  );
}

export default function DashboardHome() {
  // Use array not Set — React reliably detects array reference changes
  const [selected, setSelected] = useState<SportFilter[]>([]);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  function toggleFilter(f: SportFilter) {
    setSelected(prev =>
      prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]
    );
  }

  const filtersParam = selected.length > 0 ? selected.join(',') : 'All';

  useEffect(() => {
    setLoading(true);
    fetch(`/api/dashboard?filters=${encodeURIComponent(filtersParam)}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [filtersParam]);

  return (
    <div className="h-full overflow-y-auto scroll-touch">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">

        {/* Multi-select filters */}
        <div className="flex gap-2 flex-wrap items-center">
          {TYPE_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => toggleFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                selected.includes(f)
                  ? 'bg-orange-500 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              {f}
            </button>
          ))}
          {selected.length > 0 && (
            <button
              onClick={() => setSelected([])}
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-500 hover:text-white transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {loading ? (
          <div className="space-y-8">
            {[1, 2, 3].map(i => (
              <div key={i} className="grid grid-cols-4 gap-3">
                {[1, 2, 3, 4].map(j => (
                  <div key={j} className="bg-gray-800 rounded-xl p-4 h-20 animate-pulse" />
                ))}
              </div>
            ))}
          </div>
        ) : data ? (
          <>
            <PeriodBlock title="Week to Date" stats={data.wtd} filtersParam={filtersParam} period="wtd" />
            <PeriodBlock title="Month to Date" stats={data.mtd} filtersParam={filtersParam} period="mtd" />

            <div>
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Year to Date</h3>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {(() => {
                  const from = periodStart('ytd');
                  const qs = [
                    filtersParam !== 'All' ? `filters=${encodeURIComponent(filtersParam)}` : '',
                    `from=${from}`,
                  ].filter(Boolean).join('&');
                  const href = `/activities?${qs}`;
                  return <>
                    <StatCard label="Activities" value={data.ytd.activities ?? 0} href={href} />
                    <StatCard label="Distance" value={`${data.ytd.km ?? 0} km`} href={href} />
                    <StatCard label="Time" value={`${data.ytd.hours ?? 0} h`} href={href} />
                    <StatCard label="TSS" value={data.ytd.tss ?? 0} href={href} />
                    <StatCard label="Elevation" value={`${data.ytd.elevation ?? 0} m`} href={href} />
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
