'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { sportLabel, sportColor } from '@/lib/sport-types';

const ActivityMap = dynamic(() => import('./ActivityMap'), { ssr: false });

interface RecentRide {
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
  summary_polyline: string | null;
  average_speed: number | null;
}

interface PowerHighlight {
  label: string;
  seconds: number;
  watts: number;
  prevBest: number | null;
  isNew: boolean;
}

interface FeedData {
  recentRides: RecentRide[];
  nextEvent: { name: string; date: string; goal: string; daysAway: number } | null;
  fitness: { ctl: number; atl: number; tsb: number };
  powerHighlights: PowerHighlight[];
  lastCyclingRideId: number | null;
}

function fmt(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m.toString().padStart(2,'0')}m` : `${m}m`;
}

function relDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = diffMs / 3600000;
  if (diffH < 1) return 'Just now';
  if (diffH < 24) return `${Math.floor(diffH)}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'Yesterday';
  if (diffD < 7) return `${diffD} days ago`;
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

function timeOfDay(iso: string) {
  return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// Lazy-load map only when card scrolls into view
function LazyMap({ polyline }: { polyline: string }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { rootMargin: '100px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={ref} className="w-full h-44 rounded-xl overflow-hidden bg-gray-800/60">
      {visible && <ActivityMap polyline={polyline} className="w-full h-44" thumbnail />}
    </div>
  );
}

// Streaming coaching tip
function CoachingTip() {
  const [tip, setTip] = useState('');
  const [done, setDone] = useState(false);
  const fetched = useRef(false);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{
          role: 'user',
          content: 'In 3–4 sentences, give me the single most important coaching insight or recommendation based on my current CTL/ATL/TSB, recent training, and upcoming events. Be direct, specific, and reference actual numbers.',
        }],
      }),
    }).then(async res => {
      const reader = res.body?.getReader();
      if (!reader) return;
      const dec = new TextDecoder();
      let text = '';
      while (true) {
        const { done: d, value } = await reader.read();
        if (d) break;
        text += dec.decode(value, { stream: true });
        setTip(text);
      }
      setDone(true);
    }).catch(() => { setTip('Unable to load coaching tip.'); setDone(true); });
  }, []);

  return (
    <div className="bg-gray-800/60 rounded-2xl p-4 border border-orange-500/20">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-6 h-6 rounded-full bg-orange-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">C</div>
        <span className="text-xs font-semibold text-orange-400 uppercase tracking-wider">Coaching Insight</span>
      </div>
      {!tip && !done ? (
        <div className="space-y-2">
          <div className="h-3 bg-gray-700 rounded animate-pulse w-full" />
          <div className="h-3 bg-gray-700 rounded animate-pulse w-4/5" />
          <div className="h-3 bg-gray-700 rounded animate-pulse w-3/5" />
        </div>
      ) : (
        <p className="text-sm text-gray-300 leading-relaxed">
          {tip}
          {!done && <span className="inline-block w-1 h-3.5 bg-orange-400 ml-0.5 animate-pulse align-middle" />}
        </p>
      )}
      <Link href="/chat" className="mt-3 inline-flex items-center gap-1.5 text-xs text-orange-400 hover:text-orange-300 transition-colors">
        Ask a follow-up
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </Link>
    </div>
  );
}

export default function DashboardHome() {
  const [data, setData] = useState<FeedData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/analytics/feed')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="h-full overflow-y-auto scroll-touch">
        <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-gray-800 rounded-2xl h-28 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const { recentRides = [], nextEvent, fitness, powerHighlights = [] } = data ?? {};
  const newPRs = powerHighlights.filter(p => p.isNew);
  const tsbLabel = (fitness?.tsb ?? 0) >= 5 ? 'Fresh' : (fitness?.tsb ?? 0) <= -20 ? 'Fatigued' : 'Neutral';
  const tsbColor = (fitness?.tsb ?? 0) >= 5 ? 'text-green-400' : (fitness?.tsb ?? 0) <= -20 ? 'text-red-400' : 'text-yellow-400';

  return (
    <div className="h-full overflow-y-auto scroll-touch">
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4 pb-8">

        {/* Next Event countdown */}
        {nextEvent && (
          <div className="bg-gradient-to-r from-orange-500/10 to-orange-500/5 rounded-2xl p-4 border border-orange-500/25">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold text-orange-400 uppercase tracking-wider mb-0.5">Next Event</p>
                <p className="text-base font-bold text-white truncate">{nextEvent.name}</p>
                {nextEvent.goal && <p className="text-xs text-gray-400 mt-0.5">Goal: {nextEvent.goal}</p>}
              </div>
              <div className="text-right flex-shrink-0 ml-4">
                <span className="text-3xl font-black text-orange-400">{nextEvent.daysAway}</span>
                <p className="text-xs text-gray-400">days away</p>
              </div>
            </div>
          </div>
        )}

        {/* Fitness snapshot */}
        {fitness && (
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-gray-800/60 rounded-xl p-3 text-center">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Fitness (CTL)</p>
              <p className="text-xl font-bold text-blue-400">{fitness.ctl}</p>
            </div>
            <div className="bg-gray-800/60 rounded-xl p-3 text-center">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Fatigue (ATL)</p>
              <p className="text-xl font-bold text-purple-400">{fitness.atl}</p>
            </div>
            <div className="bg-gray-800/60 rounded-xl p-3 text-center">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Form (TSB)</p>
              <p className={`text-xl font-bold ${tsbColor}`}>{fitness.tsb > 0 ? '+' : ''}{fitness.tsb}</p>
              <p className={`text-[10px] ${tsbColor}`}>{tsbLabel}</p>
            </div>
          </div>
        )}

        {/* Coaching Insight */}
        <CoachingTip />

        {/* Power PRs */}
        {powerHighlights.length > 0 && (
          <div className="bg-gray-800/60 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
              </svg>
              <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                Last Ride Power
                {newPRs.length > 0 && (
                  <span className="ml-2 px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded text-[10px]">
                    {newPRs.length} NEW PR{newPRs.length > 1 ? 's' : ''}
                  </span>
                )}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {powerHighlights.map(p => (
                <div
                  key={p.seconds}
                  className={`rounded-xl p-3 ${p.isNew ? 'bg-yellow-500/10 border border-yellow-500/30' : 'bg-gray-700/40'}`}
                >
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">{p.label}</p>
                  <p className={`text-lg font-bold ${p.isNew ? 'text-yellow-300' : 'text-white'}`}>{p.watts}W</p>
                  {p.isNew ? (
                    <p className="text-[10px] text-yellow-400 font-semibold">🏆 NEW PR{p.prevBest ? ` (+${p.watts - p.prevBest}W)` : ''}</p>
                  ) : p.prevBest ? (
                    <p className="text-[10px] text-gray-500">Best: {p.prevBest}W</p>
                  ) : null}
                </div>
              ))}
            </div>
            {data?.lastCyclingRideId && (
              <Link
                href={`/activities/${data.lastCyclingRideId}`}
                className="mt-3 inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-orange-400 transition-colors"
              >
                View full ride analysis →
              </Link>
            )}
          </div>
        )}

        {/* Recent rides feed */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Recent Rides</h2>
            <Link href="/activities" className="text-xs text-orange-400 hover:text-orange-300 transition-colors">
              All activities →
            </Link>
          </div>

          <div className="space-y-3">
            {recentRides.map(ride => {
              const color = sportColor(ride.sport_type);
              const np = ride.normalized_power ?? ride.average_watts;
              const speedKph = ride.average_speed ? (ride.average_speed * 3.6).toFixed(1) : null;

              return (
                <Link
                  key={ride.id}
                  href={`/activities/${ride.id}`}
                  className="block bg-gray-800/60 rounded-2xl overflow-hidden border border-gray-700/40 hover:border-gray-600/60 transition-colors group"
                >
                  {/* Card header */}
                  <div className="px-4 pt-4 pb-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className="px-2 py-0.5 rounded text-[10px] font-semibold flex-shrink-0"
                            style={{ background: color + '22', color }}
                          >
                            {sportLabel(ride.sport_type)}{ride.trainer ? ' · Indoor' : ''}
                          </span>
                          <span className="text-[11px] text-gray-500 truncate">
                            {relDate(ride.start_date)} · {timeOfDay(ride.start_date)}
                          </span>
                        </div>
                        <h3 className="text-base font-bold text-white group-hover:text-orange-300 transition-colors truncate leading-tight">
                          {ride.name}
                        </h3>
                      </div>
                      <svg className="w-4 h-4 text-gray-600 group-hover:text-orange-400 transition-colors flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>

                    {/* Stats strip */}
                    <div className="flex items-center gap-3 flex-wrap text-sm">
                      {ride.distance > 0 && (
                        <span className="font-semibold text-white">{(ride.distance / 1000).toFixed(1)}<span className="text-xs text-gray-500 ml-0.5">km</span></span>
                      )}
                      {speedKph && (
                        <span className="text-gray-400">{speedKph}<span className="text-xs ml-0.5">km/h</span></span>
                      )}
                      <span className="text-gray-400">{fmt(ride.moving_time)}</span>
                      {ride.total_elevation_gain > 0 && (
                        <span className="text-gray-400">{Math.round(ride.total_elevation_gain)}<span className="text-xs ml-0.5">m</span></span>
                      )}
                      {np && (
                        <span className="text-gray-300">{Math.round(np)}<span className="text-xs text-gray-500 ml-0.5">W</span></span>
                      )}
                      {ride.tss && (
                        <span className="text-orange-400 text-xs font-medium">{Math.round(ride.tss)} TSS</span>
                      )}
                      {ride.average_heartrate && (
                        <span className="text-red-400 text-xs">♥ {Math.round(ride.average_heartrate)}</span>
                      )}
                    </div>
                  </div>

                  {/* Map */}
                  {ride.summary_polyline && (
                    <div className="px-3 pb-3">
                      <LazyMap polyline={ride.summary_polyline} />
                    </div>
                  )}
                </Link>
              );
            })}

            {recentRides.length === 0 && (
              <div className="text-center py-10 text-gray-500 text-sm">No recent rides found.</div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
