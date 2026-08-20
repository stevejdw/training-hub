'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useCachedFetch } from '@/lib/use-cached-fetch';
import { sportLabel } from '@/lib/sport-types';
import { FEED_CACHE_KEY, type FeedData } from '@/components/FeedPage';
import FitnessChart, { FITNESS_RANGES, type FitnessPoint } from '@/components/training/FitnessChart';
import { TssWeekChart } from '@/components/training/FitnessTab';
import ReadinessResponseWidget from '@/components/ReadinessResponseWidget';
import DesktopPage from './DesktopPage';
import Panel from './Panel';
import ErrorState from '@/components/ui/ErrorState';
import DashboardTop from '@/components/dashboard/DashboardTop';

function fmtTime(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m}m`;
}

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}




/** Multi-panel dashboard shown on /home at lg+. All data comes from
 *  existing endpoints; the mobile FeedPage is untouched. */
export default function DesktopDashboard() {
  const [days, setDays] = useState(90);

  const { data: feed, error: feedError, refetch: refetchFeed } =
    useCachedFetch<FeedData>('/api/analytics/feed', FEED_CACHE_KEY);

  const daysParam = days < 0 ? 'all' : String(days);
  const { data: fitnessResp, loading: fitnessLoading, error: fitnessError, refetch: refetchFitnessRaw } = useCachedFetch<{ data: FitnessPoint[] }>(
    `/api/analytics/fitness?days=${daysParam}`,
    `cache-fitness-desktop-${daysParam}`,
  );
  const refetchFitness = refetchFitnessRaw;
  const fitnessData = fitnessResp?.data ?? [];

  const fitness = feed?.fitness;
  const rides = feed?.recentRides ?? [];

  return (
    <DesktopPage
      title="Dashboard"
      scroll="lg"
      actions={
        <Link href="/activities" className="text-sm text-accent-hi hover:text-accent-hi font-medium transition-colors">
          All activities →
        </Link>
      }
    >
      {/* Stacks below lg for the tablet band; the explicit panel heights stop
          Recharts' ResponsiveContainer collapsing to zero outside an h-full
          grid track. */}
      <div className="h-full grid grid-cols-1 lg:grid-cols-12 gap-4">

        {/* ── Left: fitness chart + recent activities ── */}
        <div className="lg:col-span-8 lg:h-full min-h-0 flex flex-col gap-4">
          <Panel
            title="Fitness — ATL · CTL · Form (TSB)"
            className="h-[340px] lg:h-auto lg:flex-[3]"
            controls={
              <div className="flex gap-1">
                {FITNESS_RANGES.map(({ d, label }) => (
                  <button
                    key={d}
                    onClick={() => setDays(d)}
                    className={`px-2 py-1 rounded-md text-micro font-medium transition-colors ${
                      days === d
                        ? 'bg-accent/20 text-accent-hi border border-accent/50'
                        : 'bg-raised text-ink-3 hover:text-ink'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
          >
            {fitnessError && fitnessData.length === 0
              ? <ErrorState message="Could not load fitness history." onRetry={refetchFitness} />
              : <FitnessChart data={fitnessData} loading={fitnessLoading && fitnessData.length === 0} days={days} setDays={setDays} height="100%" />}
          </Panel>

          <Panel title="Recent activities" className="h-[380px] lg:h-auto lg:flex-[2]" bodyClassName="overflow-y-auto">
            {feedError && rides.length === 0 ? (
              <ErrorState message="Could not load recent activities." onRetry={refetchFeed} />
            ) : rides.length === 0 ? (
              <p className="text-sm text-ink-4">No recent activities.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="text-left text-micro text-ink-4 uppercase tracking-wider">
                    <th className="py-1.5 pr-3 font-semibold">Date</th>
                    <th className="py-1.5 pr-3 font-semibold">Name</th>
                    <th className="py-1.5 pr-3 font-semibold text-right">Distance</th>
                    <th className="py-1.5 pr-3 font-semibold text-right">Time</th>
                    <th className="py-1.5 pr-3 font-semibold text-right hidden lg:table-cell">NP</th>
                    <th className="py-1.5 pr-3 font-semibold text-right hidden lg:table-cell">IF</th>
                    <th className="py-1.5 pr-3 font-semibold text-right">TSS</th>
                    <th className="py-1.5 font-semibold text-right hidden lg:table-cell">Elev</th>
                  </tr>
                </thead>
                <tbody>
                  {rides.map(r => (
                    <tr key={r.id} className="border-t border-line/70 hover:bg-raised/40 transition-colors">
                      <td className="py-2 pr-3 text-ink-3 whitespace-nowrap">{fmtDay(r.start_date)}</td>
                      <td className="py-2 pr-3 min-w-0">
                        <Link href={`/activities/${r.id}`} className="text-ink hover:text-accent-hi font-medium transition-colors">
                          {r.name}
                        </Link>
                        <span className="ml-2 text-micro text-ink-4">{sportLabel(r.sport_type)}</span>
                      </td>
                      <td className="py-2 pr-3 text-right text-ink-2 tabular-nums">{(r.distance / 1000).toFixed(1)} km</td>
                      <td className="py-2 pr-3 text-right text-ink-2 tabular-nums">{fmtTime(r.moving_time)}</td>
                      <td className="py-2 pr-3 text-right text-ink-2 tabular-nums hidden lg:table-cell">
                        {r.normalized_power ?? r.average_watts ?? '—'}{(r.normalized_power ?? r.average_watts) ? ' W' : ''}
                      </td>
                      <td className="py-2 pr-3 text-right text-ink-2 tabular-nums hidden lg:table-cell">
                        {r.intensity_factor != null ? Number(r.intensity_factor).toFixed(2) : '—'}
                      </td>
                      <td className="py-2 pr-3 text-right text-accent-hi tabular-nums">{r.tss != null ? Math.round(r.tss) : '—'}</td>
                      <td className="py-2 text-right text-ink-2 tabular-nums hidden lg:table-cell">{Math.round(r.total_elevation_gain)} m</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        {/* ── Right: form snapshot, readiness, weekly TSS, what's next ── */}
        <div className="lg:col-span-4 lg:h-full min-h-0 lg:overflow-y-auto space-y-4">
          <DashboardTop feed={feed} />

          <ReadinessResponseWidget />
          <TssWeekChart />

        </div>
      </div>
    </DesktopPage>
  );
}
