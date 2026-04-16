'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SPORT_FILTER_LABELS, SportFilter, sportLabel, sportColor } from '@/lib/sport-types';

interface Activity {
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
}

function fmt(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}h` : `${m}m`;
}

// Filter labels excluding 'All'
const TYPE_FILTERS = SPORT_FILTER_LABELS.filter(f => f !== 'All') as SportFilter[];

export default function ActivitiesList() {
  const [selected, setSelected] = useState<Set<SportFilter>>(new Set());
  const [activities, setActivities] = useState<Activity[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  function toggleFilter(f: SportFilter) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(f)) {
        next.delete(f);
      } else {
        next.add(f);
      }
      return next;
    });
    setPage(1);
  }

  function clearFilters() {
    setSelected(new Set());
    setPage(1);
  }

  useEffect(() => {
    setLoading(true);
    const filtersParam = selected.size > 0 ? [...selected].join(',') : 'All';
    fetch(`/api/activities?filters=${filtersParam}&page=${page}`)
      .then((r) => r.json())
      .then((d) => {
        setActivities(d.activities);
        setPages(d.pages);
        setTotal(d.total);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [selected, page]);

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-800 px-4 py-3 flex items-center gap-3 flex-wrap flex-shrink-0">
        <div className="flex gap-2 flex-wrap">
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
              onClick={clearFilters}
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-500 hover:text-white transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        {!loading && (
          <span className="text-sm text-gray-500 ml-auto">{total.toLocaleString()} activities</span>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
            <tr>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Date</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium hidden sm:table-cell">Type</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Name</th>
              <th className="text-right px-4 py-3 text-gray-400 font-medium">Dist</th>
              <th className="text-right px-4 py-3 text-gray-400 font-medium">Time</th>
              <th className="text-right px-4 py-3 text-gray-400 font-medium hidden md:table-cell">Avg W</th>
              <th className="text-right px-4 py-3 text-gray-400 font-medium hidden md:table-cell">Avg HR</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-800/50">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-gray-800 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              : activities.map((a) => {
                  const date = new Date(a.start_date);
                  const color = sportColor(a.sport_type);
                  return (
                    <tr key={a.id} className="border-b border-gray-800/50 hover:bg-gray-800/40 transition-colors">
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                        {date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span
                          className="px-2 py-0.5 rounded text-xs font-medium"
                          style={{ background: color + '20', color }}
                        >
                          {sportLabel(a.sport_type)}{a.trainer ? ' 🏠' : ''}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/activities/${a.id}`}
                          className="text-white hover:text-orange-400 transition-colors line-clamp-1"
                        >
                          {a.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-300">
                        {a.distance > 0 ? `${(a.distance / 1000).toFixed(1)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-300">{fmt(a.moving_time)}</td>
                      <td className="px-4 py-3 text-right text-gray-300 hidden md:table-cell">
                        {a.average_watts ? `${Math.round(a.average_watts)}W` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-300 hidden md:table-cell">
                        {a.average_heartrate ? Math.round(a.average_heartrate) : '—'}
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="border-t border-gray-800 px-4 py-3 flex items-center justify-between flex-shrink-0">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 rounded-lg text-sm bg-gray-800 text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          <span className="text-sm text-gray-500">Page {page} of {pages}</span>
          <button
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page === pages}
            className="px-3 py-1.5 rounded-lg text-sm bg-gray-800 text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
