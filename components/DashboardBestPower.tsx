'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { sportLabel, sportColor } from '@/lib/sport-types';

const INTERVALS = [
  { label: '1 sec',  seconds: 1 },
  { label: '3 sec',  seconds: 3 },
  { label: '5 sec',  seconds: 5 },
  { label: '10 sec', seconds: 10 },
  { label: '30 sec', seconds: 30 },
  { label: '1 min',  seconds: 60 },
  { label: '2 min',  seconds: 120 },
  { label: '3 min',  seconds: 180 },
  { label: '5 min',  seconds: 300 },
  { label: '8 min',  seconds: 480 },
  { label: '10 min', seconds: 600 },
  { label: '15 min', seconds: 900 },
  { label: '20 min', seconds: 1200 },
  { label: '30 min', seconds: 1800 },
  { label: '45 min', seconds: 2700 },
  { label: '60 min', seconds: 3600 },
  { label: '90 min', seconds: 5400 },
  { label: '2 hr',   seconds: 7200 },
  { label: '3 hr',   seconds: 10800 },
  { label: '4 hr',   seconds: 14400 },
  { label: '5 hr',   seconds: 18000 },
  { label: '6 hr',   seconds: 21600 },
  { label: '7 hr',   seconds: 25200 },
  { label: '8 hr',   seconds: 28800 },
  { label: '9 hr',   seconds: 32400 },
  { label: '10 hr',  seconds: 36000 },
  { label: '11 hr',  seconds: 39600 },
  { label: '12 hr',  seconds: 43200 },
  { label: '15 hr',  seconds: 54000 },
];

const TIME_FILTERS = [
  { label: '30 days',   days: 30 },
  { label: '90 days',   days: 90 },
  { label: '6 months',  days: 180 },
  { label: '1 year',    days: 365 },
  { label: 'All time',  days: 0 },
];

interface Result {
  id: number;
  name: string;
  start_date: string;
  sport_type: string;
  best_watts: number;
}

export default function DashboardBestPower() {
  const [seconds, setSeconds] = useState(300);
  const [days,    setDays]    = useState(365);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/dashboard/best-power?seconds=${seconds}&days=${days}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setResults([]); }
        else setResults(d.results ?? []);
        setLoading(false);
      })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [seconds, days]);

  const intervalLabel = INTERVALS.find(i => i.seconds === seconds)?.label ?? '';

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex gap-2 flex-wrap items-center">
        {/* Interval */}
        <select
          value={seconds}
          onChange={e => setSeconds(Number(e.target.value))}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-orange-500"
        >
          {INTERVALS.map(iv => (
            <option key={iv.seconds} value={iv.seconds}>{iv.label}</option>
          ))}
        </select>

        {/* Time filter chips */}
        <div className="flex gap-1.5 flex-wrap">
          {TIME_FILTERS.map(tf => (
            <button
              key={tf.days}
              onClick={() => setDays(tf.days)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                days === tf.days
                  ? 'bg-orange-500 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="bg-gray-800/60 rounded-xl overflow-hidden">
        {error ? (
          <p className="text-red-400 text-xs p-4">{error}</p>
        ) : loading ? (
          <div className="divide-y divide-gray-700/50">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="w-5 h-3 bg-gray-700 rounded animate-pulse" />
                <div className="flex-1 h-3 bg-gray-700 rounded animate-pulse" />
                <div className="w-16 h-3 bg-gray-700 rounded animate-pulse" />
                <div className="w-14 h-4 bg-gray-700 rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : results.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-8">
            No power data for this period — run the backfill workflow first
          </p>
        ) : (
          <div className="divide-y divide-gray-700/50">
            {results.map((r, i) => {
              const color = sportColor(r.sport_type);
              const date  = new Date(r.start_date);
              return (
                <Link
                  key={r.id}
                  href={`/activities/${r.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-gray-700/40 transition-colors"
                >
                  {/* Rank */}
                  <span className="w-5 text-xs font-bold text-gray-500 flex-shrink-0">{i + 1}</span>

                  {/* Sport badge */}
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0"
                    style={{ background: color + '25', color }}
                  >
                    {sportLabel(r.sport_type)}
                  </span>

                  {/* Name + date */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{r.name}</p>
                    <p className="text-[10px] text-gray-500">
                      {date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })}
                    </p>
                  </div>

                  {/* Watts */}
                  <div className="text-right flex-shrink-0">
                    <span className="text-base font-bold text-white">{r.best_watts}</span>
                    <span className="text-xs text-gray-400 ml-0.5">W</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {results.length > 0 && (
        <p className="text-[10px] text-gray-600 text-center">
          Top 10 best {intervalLabel} power
          {days > 0 ? ` · last ${TIME_FILTERS.find(t => t.days === days)?.label}` : ' · all time'}
        </p>
      )}
    </div>
  );
}
