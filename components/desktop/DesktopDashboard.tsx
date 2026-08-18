'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useCachedFetch } from '@/lib/use-cached-fetch';
import { sportLabel } from '@/lib/sport-types';
import type { FeedData } from '@/components/FeedPage';
import FitnessChart, { FITNESS_RANGES, type FitnessPoint } from '@/components/training/FitnessChart';
import { TssWeekChart } from '@/components/training/FitnessTab';
import ReadinessResponseWidget from '@/components/ReadinessResponseWidget';
import DesktopPage from './DesktopPage';
import Panel from './Panel';
import { CHART } from '@/lib/chart-theme';

function fmtTime(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m}m`;
}

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

const tsbColor = (v: number) => v >= 5 ? '#34d399' : v <= -20 ? '#f87171' : '#facc15';

function StatTile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-surface border border-line rounded-xl p-3 text-center min-w-0">
      <p className="text-micro text-ink-4 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-2xl font-bold" style={color ? { color } : undefined}>{value}</p>
      {sub && <p className="text-micro text-ink-4 mt-0.5">{sub}</p>}
    </div>
  );
}

/** Multi-panel dashboard shown on /home at lg+. All data comes from
 *  existing endpoints; the mobile FeedPage is untouched. */
export default function DesktopDashboard() {
  const [days, setDays] = useState(90);

  const { data: feed } = useCachedFetch<FeedData>('/api/analytics/feed', 'cache-feed-desktop');

  const daysParam = days < 0 ? 'all' : String(days);
  const { data: fitnessResp, loading: fitnessLoading } = useCachedFetch<{ data: FitnessPoint[] }>(
    `/api/analytics/fitness?days=${daysParam}`,
    `cache-fitness-desktop-${daysParam}`,
  );
  const fitnessData = fitnessResp?.data ?? [];

  const fitness = feed?.fitness;
  const rides = feed?.recentRides ?? [];

  return (
    <DesktopPage
      title="Dashboard"
      scroll={false}
      actions={
        <Link href="/activities" className="text-sm text-accent-hi hover:text-accent-hi font-medium transition-colors">
          All activities →
        </Link>
      }
    >
      <div className="h-full grid grid-cols-12 gap-4">

        {/* ── Left: fitness chart + recent activities ── */}
        <div className="col-span-8 h-full min-h-0 flex flex-col gap-4">
          <Panel
            title="Fitness — ATL · CTL · Form (TSB)"
            className="flex-[3]"
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
            <FitnessChart data={fitnessData} loading={fitnessLoading && fitnessData.length === 0} days={days} setDays={setDays} height="100%" />
          </Panel>

          <Panel title="Recent activities" className="flex-[2]" bodyClassName="overflow-y-auto">
            {rides.length === 0 ? (
              <p className="text-sm text-ink-4">No recent activities.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="text-left text-micro text-ink-4 uppercase tracking-wider">
                    <th className="py-1.5 pr-3 font-semibold">Date</th>
                    <th className="py-1.5 pr-3 font-semibold">Name</th>
                    <th className="py-1.5 pr-3 font-semibold text-right">Distance</th>
                    <th className="py-1.5 pr-3 font-semibold text-right">Time</th>
                    <th className="py-1.5 pr-3 font-semibold text-right">NP</th>
                    <th className="py-1.5 pr-3 font-semibold text-right">TSS</th>
                    <th className="py-1.5 font-semibold text-right">Elev</th>
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
                      <td className="py-2 pr-3 text-right text-ink-2 tabular-nums">
                        {r.normalized_power ?? r.average_watts ?? '—'}{(r.normalized_power ?? r.average_watts) ? ' W' : ''}
                      </td>
                      <td className="py-2 pr-3 text-right text-accent-hi tabular-nums">{r.tss != null ? Math.round(r.tss) : '—'}</td>
                      <td className="py-2 text-right text-ink-2 tabular-nums">{Math.round(r.total_elevation_gain)} m</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        {/* ── Right: form snapshot, readiness, weekly TSS, what's next ── */}
        <div className="col-span-4 h-full min-h-0 overflow-y-auto space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="Fitness" value={fitness ? String(fitness.ctl) : '—'} sub="CTL" color={CHART.hr} />
            <StatTile label="Fatigue" value={fitness ? String(fitness.atl) : '—'} sub="ATL" color={CHART.atl} />
            <StatTile
              label="Form"
              value={fitness ? `${fitness.tsb > 0 ? '+' : ''}${fitness.tsb}` : '—'}
              sub="TSB"
              color={fitness ? tsbColor(fitness.tsb) : undefined}
            />
          </div>

          <ReadinessResponseWidget />
          <TssWeekChart />

          {feed?.nextSession && (
            <div className="bg-surface border border-line rounded-xl p-4">
              <p className="text-xs font-semibold text-ink-4 uppercase tracking-wider mb-2">Next session</p>
              <p className="text-sm font-medium text-ink">{feed.nextSession.title}</p>
              <p className="text-xs text-ink-3 mt-1">
                {fmtDay(feed.nextSession.date)}
                {feed.nextSession.duration_min ? ` · ${feed.nextSession.duration_min} min` : ''}
                {feed.nextSession.tss_target ? ` · ${feed.nextSession.tss_target} TSS` : ''}
              </p>
            </div>
          )}

          {feed?.nextEvent && (
            <Link href={`/events/${feed.nextEvent.id}`} className="block bg-surface border border-accent/40 rounded-xl p-4 hover:border-accent/70 transition-colors">
              <p className="text-xs font-semibold text-accent-hi uppercase tracking-wider mb-1">Next event</p>
              <p className="text-sm font-medium text-ink">{feed.nextEvent.name}</p>
              <p className="text-xs text-ink-3 mt-1">{feed.nextEvent.daysAway} days away</p>
            </Link>
          )}
        </div>
      </div>
    </DesktopPage>
  );
}
