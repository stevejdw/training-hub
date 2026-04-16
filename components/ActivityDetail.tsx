'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { sportLabel, sportColor } from '@/lib/sport-types';

interface Activity {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  total_elevation_gain: number;
  average_watts: number | null;
  weighted_average_watts: number | null;
  max_watts: number | null;
  kilojoules: number | null;
  average_heartrate: number | null;
  max_heartrate: number | null;
  suffer_score: number | null;
  trainer: boolean;
  average_speed: number | null;
  tss: number | null;
  intensity_factor: number | null;
  normalized_power: number | null;
}

function fmt(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m}:${s.toString().padStart(2, '0')}`;
}

function Stat({ label, value }: { label: string; value: string | number | null }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xl font-bold text-white">{value}</div>
    </div>
  );
}

const FTP = 340;

export default function ActivityDetail({ id }: { id: string }) {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/api/activities/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error('Not found');
        return r.json();
      })
      .then((d) => { setActivity(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-gray-800 rounded-xl h-20 animate-pulse" />
        ))}
      </div>
    );
  }

  if (error || !activity) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 text-center text-gray-400">
        Activity not found.{' '}
        <Link href="/activities" className="text-orange-400 hover:underline">Back to activities</Link>
      </div>
    );
  }

  const date = new Date(activity.start_date);
  const color = sportColor(activity.sport_type);

  // eFTP estimate from this activity (best 20-min proxy via IF × FTP)
  const eFTPEstimate = activity.intensity_factor && activity.moving_time >= 1200
    ? Math.round(activity.intensity_factor * FTP)
    : null;

  const np = activity.normalized_power ?? activity.weighted_average_watts;

  return (
    <div className="h-[calc(100vh-64px)] overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

        {/* Back link */}
        <Link href="/activities" className="text-sm text-gray-500 hover:text-orange-400 transition-colors">
          ← Activities
        </Link>

        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span
              className="px-2 py-0.5 rounded text-xs font-medium"
              style={{ background: color + '20', color }}
            >
              {sportLabel(activity.sport_type)}
              {activity.trainer ? ' · Indoor' : ''}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-white">{activity.name}</h1>
          <p className="text-gray-400 mt-1">
            {date.toLocaleDateString('en-AU', {
              weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
            })}
            {' · '}
            {date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>

        {/* Primary stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {activity.distance > 0 && (
            <Stat label="Distance" value={`${(activity.distance / 1000).toFixed(2)} km`} />
          )}
          <Stat label="Moving Time" value={fmt(activity.moving_time)} />
          {activity.total_elevation_gain > 0 && (
            <Stat label="Elevation" value={`${Math.round(activity.total_elevation_gain)} m`} />
          )}
          {activity.tss !== null && <Stat label="TSS" value={Math.round(activity.tss)} />}
          {activity.average_watts && (
            <Stat label="Avg Power" value={`${Math.round(activity.average_watts)}W`} />
          )}
          {np && <Stat label="NP" value={`${Math.round(np)}W`} />}
          {eFTPEstimate && <Stat label="eFTP Est." value={`${eFTPEstimate}W`} />}
          {activity.average_heartrate && (
            <Stat label="Avg HR" value={`${Math.round(activity.average_heartrate)} bpm`} />
          )}
          {activity.max_heartrate && (
            <Stat label="Max HR" value={`${Math.round(activity.max_heartrate)} bpm`} />
          )}
          {activity.intensity_factor && (
            <Stat label="IF" value={activity.intensity_factor.toFixed(2)} />
          )}
          {activity.max_watts && (
            <Stat label="Peak Power" value={`${Math.round(activity.max_watts)}W`} />
          )}
          {activity.kilojoules && (
            <Stat label="Energy" value={`${Math.round(activity.kilojoules)} kJ`} />
          )}
          {activity.suffer_score && (
            <Stat label="Suffer Score" value={activity.suffer_score} />
          )}
        </div>

        {/* Laps placeholder */}
        <div className="bg-gray-800/50 border border-gray-700 border-dashed rounded-xl p-6 text-center">
          <p className="text-gray-500 text-sm font-medium">Lap data not yet synced</p>
          <p className="text-gray-600 text-xs mt-1">
            Add lap sync to the GitHub Actions workflow to enable this section
          </p>
        </div>

        {/* Map placeholder */}
        <div className="bg-gray-800/50 border border-gray-700 border-dashed rounded-xl p-6 text-center">
          <p className="text-gray-500 text-sm font-medium">Map not yet available</p>
          <p className="text-gray-600 text-xs mt-1">
            Add <code className="bg-gray-800 px-1 rounded">summary_polyline</code> to the activities sync to enable the map
          </p>
        </div>
      </div>
    </div>
  );
}
