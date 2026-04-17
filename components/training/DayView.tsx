'use client';

import Link from 'next/link';
import { TrainingDay, TrainingSegment } from '@/lib/training-plans';

interface ActivityDetail {
  id: number;
  name: string;
  date: string;
  tss: number;
  moving_time: number;
  distance: number;
  average_watts: number | null;
  normalized_power: number | null;
  weighted_average_watts: number | null;
  weighted_average_watts_np?: number | null;
  average_heartrate: number | null;
  max_heartrate: number | null;
  intensity_factor: number | null;
}

interface Props {
  day: TrainingDay;
  activities: ActivityDetail[];
  onBack: () => void;
}

const SEG_COLORS: Record<string, string> = {
  warmup:   'border-blue-700/50 bg-blue-900/20',
  main:     'border-orange-700/50 bg-orange-900/20',
  cooldown: 'border-green-700/50 bg-green-900/20',
  interval: 'border-red-700/50 bg-red-900/20',
};

const SEG_LABELS: Record<string, string> = {
  warmup:   'Warm-up',
  main:     'Main Set',
  cooldown: 'Cool-down',
  interval: 'Interval',
};

const TYPE_BADGE: Record<string, string> = {
  rest:       'bg-gray-700 text-gray-400',
  recovery:   'bg-blue-900/60 text-blue-400',
  endurance:  'bg-green-900/60 text-green-400',
  tempo:      'bg-yellow-900/60 text-yellow-400',
  threshold:  'bg-orange-900/60 text-orange-400',
  vo2max:     'bg-red-900/60 text-red-400',
  race:       'bg-purple-900/60 text-purple-400',
};

function fmt(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m > 0 ? m + 'm' : ''}`.trim() : `${m}m`;
}

function SegmentCard({ seg }: { seg: TrainingSegment }) {
  const isMain = seg.type === 'main' || seg.type === 'interval';

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${SEG_COLORS[seg.type] ?? SEG_COLORS.main}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          {SEG_LABELS[seg.type] ?? seg.type}
        </span>
        <span className="text-xs text-gray-400">{seg.duration_min} min</span>
      </div>

      {/* Main set: description is the star — show it large */}
      {isMain && seg.description ? (
        <p className="text-sm font-medium text-white leading-relaxed">{seg.description}</p>
      ) : seg.description ? (
        <p className="text-sm text-gray-400">{seg.description}</p>
      ) : null}

      {/* Power / HR targets */}
      {(seg.target_np_watts || seg.target_avg_hr || seg.zone) && (
        <div className="flex gap-2 flex-wrap">
          {seg.target_np_watts && (
            <div className="bg-black/20 rounded-lg px-3 py-2 flex items-center gap-2">
              <div>
                <p className="text-[10px] text-gray-500 uppercase leading-none mb-0.5">
                  {isMain ? 'Avg Target' : 'Target'}
                </p>
                <p className="text-sm font-bold text-white">{seg.target_np_watts}W</p>
              </div>
            </div>
          )}
          {seg.target_avg_hr && (
            <div className="bg-black/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-gray-500 uppercase leading-none mb-0.5">HR</p>
              <p className="text-sm font-bold text-white">{seg.target_avg_hr} bpm</p>
            </div>
          )}
          {seg.zone && (
            <div className="bg-black/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-gray-500 uppercase leading-none mb-0.5">Zone</p>
              <p className="text-sm font-bold text-white">{seg.zone}</p>
            </div>
          )}
        </div>
      )}

      {seg.notes && (
        <p className="text-xs text-gray-400 italic border-t border-gray-700/50 pt-2">{seg.notes}</p>
      )}
    </div>
  );
}

function buildCommentary(activity: ActivityDetail, day: TrainingDay): string {
  const np = activity.normalized_power ?? activity.weighted_average_watts;
  const mainSeg = day.segments.find(s => s.type === 'main');
  const parts: string[] = [];

  // Duration
  if (day.duration_min > 0) {
    const prescribedSecs = day.duration_min * 60;
    const diffMins = Math.round((activity.moving_time - prescribedSecs) / 60);
    const pct = Math.abs(diffMins) / day.duration_min;
    if (pct <= 0.10) parts.push(`Duration was spot on (${fmt(activity.moving_time)}).`);
    else if (diffMins > 0) parts.push(`You rode ${diffMins} min longer than prescribed (${fmt(activity.moving_time)} vs ${fmt(prescribedSecs)}).`);
    else parts.push(`Duration was ${Math.abs(diffMins)} min shorter than prescribed (${fmt(activity.moving_time)} vs ${fmt(prescribedSecs)}).`);
  }

  // TSS
  if (day.tss_target && activity.tss > 0) {
    const diff = activity.tss - day.tss_target;
    const pct = Math.abs(diff) / day.tss_target;
    if (pct <= 0.10) parts.push(`Load was on target (${activity.tss} TSS vs ${day.tss_target} target).`);
    else if (diff > 0) parts.push(`Load was higher than planned (${activity.tss} TSS vs ${day.tss_target} target).`);
    else parts.push(`Load came in below the plan (${activity.tss} TSS vs ${day.tss_target} target).`);
  }

  // Power
  if (mainSeg?.target_np_watts && np) {
    const diff = Math.round(np) - mainSeg.target_np_watts;
    const pct = Math.abs(diff) / mainSeg.target_np_watts;
    if (pct <= 0.05) parts.push(`Power was right on target (${Math.round(np)}W NP).`);
    else if (diff > 0) parts.push(`You rode ${diff}W above the power target (${Math.round(np)}W vs ${mainSeg.target_np_watts}W NP).`);
    else parts.push(`Power came in ${Math.abs(diff)}W below target (${Math.round(np)}W vs ${mainSeg.target_np_watts}W NP).`);
  }

  // HR
  if (mainSeg?.target_avg_hr && activity.average_heartrate) {
    const diff = Math.round(activity.average_heartrate) - mainSeg.target_avg_hr;
    if (Math.abs(diff) <= 5) parts.push(`Heart rate was on target.`);
    else if (diff > 0) parts.push(`HR ran ${diff} bpm above target — check if the effort was too hard.`);
    else parts.push(`HR was ${Math.abs(diff)} bpm below target.`);
  }

  if (parts.length === 0) return 'Activity logged.';
  return parts.join(' ');
}

function ActivityComparison({ activity, day }: { activity: ActivityDetail; day: TrainingDay }) {
  const np = activity.normalized_power ?? activity.weighted_average_watts;
  const mainSeg = day.segments.find(s => s.type === 'main');
  const commentary = buildCommentary(activity, day);

  // Determine if on-target
  let onTarget = false;
  if (day.tss_target && activity.tss > 0) {
    onTarget = Math.abs(activity.tss - day.tss_target) / day.tss_target <= 0.15;
  } else if (day.duration_min > 0 && activity.moving_time > 0) {
    onTarget = Math.abs(activity.moving_time - day.duration_min * 60) / (day.duration_min * 60) <= 0.20;
  } else {
    onTarget = true;
  }

  // Segments that have at least one target to compare against
  const segsWithTargets = day.segments.filter(s => s.target_np_watts || s.target_avg_hr);

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${onTarget ? 'border-green-700/40 bg-green-900/10' : 'border-yellow-700/40 bg-yellow-900/10'}`}>
      {/* Header: tick + clickable title */}
      <div className="flex items-center gap-2 min-w-0">
        <svg className={`w-4 h-4 flex-shrink-0 ${onTarget ? 'text-green-400' : 'text-yellow-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        <Link
          href={`/activities/${activity.id}`}
          className={`text-sm font-semibold truncate hover:underline ${onTarget ? 'text-green-300 hover:text-green-200' : 'text-yellow-300 hover:text-yellow-200'}`}
          onClick={e => e.stopPropagation()}
        >
          {activity.name}
        </Link>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <div className="bg-black/20 rounded-lg p-2">
          <p className="text-[10px] text-gray-500 uppercase mb-0.5">Duration</p>
          <p className="text-sm font-bold text-white">{fmt(activity.moving_time)}</p>
          {day.duration_min > 0 && <p className="text-[10px] text-gray-500">of {fmt(day.duration_min * 60)}</p>}
        </div>
        {activity.tss > 0 && (
          <div className="bg-black/20 rounded-lg p-2">
            <p className="text-[10px] text-gray-500 uppercase mb-0.5">TSS</p>
            <p className="text-sm font-bold text-white">{activity.tss}</p>
            {day.tss_target && <p className="text-[10px] text-gray-500">of {day.tss_target}</p>}
          </div>
        )}
        {np && (
          <div className="bg-black/20 rounded-lg p-2">
            <p className="text-[10px] text-gray-500 uppercase mb-0.5">NP</p>
            <p className="text-sm font-bold text-white">{Math.round(np)}W</p>
            {mainSeg?.target_np_watts && <p className="text-[10px] text-gray-500">of {mainSeg.target_np_watts}W</p>}
          </div>
        )}
        {activity.average_watts && (
          <div className="bg-black/20 rounded-lg p-2">
            <p className="text-[10px] text-gray-500 uppercase mb-0.5">Avg W</p>
            <p className="text-sm font-bold text-white">{Math.round(activity.average_watts)}W</p>
          </div>
        )}
        {activity.average_heartrate && (
          <div className="bg-black/20 rounded-lg p-2">
            <p className="text-[10px] text-gray-500 uppercase mb-0.5">Avg HR</p>
            <p className="text-sm font-bold text-white">{Math.round(activity.average_heartrate)}</p>
            {mainSeg?.target_avg_hr && <p className="text-[10px] text-gray-500">of {mainSeg.target_avg_hr}</p>}
          </div>
        )}
        {activity.intensity_factor && (
          <div className="bg-black/20 rounded-lg p-2">
            <p className="text-[10px] text-gray-500 uppercase mb-0.5">IF</p>
            <p className="text-sm font-bold text-white">{activity.intensity_factor.toFixed(2)}</p>
          </div>
        )}
      </div>

      {/* Commentary */}
      <div className={`rounded-lg px-3 py-2.5 text-xs leading-relaxed ${onTarget ? 'bg-green-900/20 text-green-200' : 'bg-yellow-900/20 text-yellow-200'}`}>
        {commentary}
      </div>

      {/* Segment prescribed vs actual table */}
      {segsWithTargets.length > 0 && (
        <div className="pt-1 border-t border-gray-700/30 space-y-2">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider">Prescribed vs Actual</p>
          <div className="overflow-x-auto scroll-touch">
            <table className="text-xs w-full whitespace-nowrap">
              <thead>
                <tr className="border-b border-gray-700/40">
                  <th className="text-left py-1.5 pr-3 text-gray-500 font-medium">Segment</th>
                  <th className="text-right py-1.5 px-2 text-gray-500 font-medium">Duration</th>
                  <th className="text-right py-1.5 px-2 text-gray-500 font-medium">Target W</th>
                  <th className="text-right py-1.5 px-2 text-gray-500 font-medium">Actual W</th>
                  <th className="text-right py-1.5 px-2 text-gray-500 font-medium">Δ W</th>
                  <th className="text-right py-1.5 px-2 text-gray-500 font-medium">Target HR</th>
                  <th className="text-right py-1.5 pl-2 text-gray-500 font-medium">Actual HR</th>
                  <th className="text-right py-1.5 pl-2 text-gray-500 font-medium">Δ HR</th>
                </tr>
              </thead>
              <tbody>
                {segsWithTargets.map((seg, i) => {
                  const isMainSeg = seg.type === 'main' || seg.type === 'interval';
                  const actW  = isMainSeg ? (np ? Math.round(np) : null) : null;
                  const actHr = activity.average_heartrate ? Math.round(activity.average_heartrate) : null;

                  const wDiff  = seg.target_np_watts && actW  ? actW  - seg.target_np_watts  : null;
                  const hrDiff = seg.target_avg_hr   && actHr ? actHr - seg.target_avg_hr    : null;

                  const wOk  = wDiff  !== null && Math.abs(wDiff)  <= seg.target_np_watts!  * 0.10;
                  const hrOk = hrDiff !== null && Math.abs(hrDiff) <= 10;

                  return (
                    <tr key={i} className="border-b border-gray-700/20 last:border-0">
                      <td className="py-2 pr-3 text-gray-300 capitalize">{SEG_LABELS[seg.type] ?? seg.type}</td>
                      <td className="py-2 px-2 text-right text-gray-400">{seg.duration_min}m</td>
                      {/* Power */}
                      <td className="py-2 px-2 text-right text-gray-300">{seg.target_np_watts ? `${seg.target_np_watts}W` : '—'}</td>
                      <td className="py-2 px-2 text-right text-white font-medium">{actW ? `${actW}W` : '—'}</td>
                      <td className={`py-2 px-2 text-right font-medium ${wDiff === null ? 'text-gray-600' : wOk ? 'text-green-400' : 'text-yellow-400'}`}>
                        {wDiff !== null ? (wDiff > 0 ? `+${wDiff}` : `${wDiff}`) : '—'}
                      </td>
                      {/* HR */}
                      <td className="py-2 px-2 text-right text-gray-300">{seg.target_avg_hr ? `${seg.target_avg_hr}` : '—'}</td>
                      <td className="py-2 pl-2 text-right text-white font-medium">{actHr ?? '—'}</td>
                      <td className={`py-2 pl-2 text-right font-medium ${hrDiff === null ? 'text-gray-600' : hrOk ? 'text-green-400' : 'text-yellow-400'}`}>
                        {hrDiff !== null ? (hrDiff > 0 ? `+${hrDiff}` : `${hrDiff}`) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {np && <p className="text-[10px] text-gray-600">Actual W = activity NP (overall). Actual HR = activity avg HR (overall).</p>}
        </div>
      )}
    </div>
  );
}

export default function DayView({ day, activities, onBack }: Props) {
  const dateLabel = new Date(day.date + 'T00:00:00Z').toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button
          onClick={onBack}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors flex-shrink-0 mt-0.5"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-[10px] rounded px-1.5 py-0.5 capitalize font-medium ${TYPE_BADGE[day.type] ?? TYPE_BADGE.endurance}`}>
              {day.type}
            </span>
            {day.tss_target && (
              <span className="text-[10px] text-orange-400 bg-orange-500/10 rounded px-1.5 py-0.5">{day.tss_target} TSS target</span>
            )}
            {day.duration_min > 0 && (
              <span className="text-[10px] text-gray-500">{fmt(day.duration_min * 60)}</span>
            )}
          </div>
          <h2 className="text-lg font-bold text-white">{day.title}</h2>
          <p className="text-xs text-gray-400">{dateLabel}</p>
        </div>
      </div>

      {/* Description */}
      {day.description && (
        <div className="bg-gray-800/60 rounded-xl p-4">
          <p className="text-sm text-gray-300">{day.description}</p>
        </div>
      )}

      {/* Segments */}
      {day.segments.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Session Structure</h3>
          {day.segments.map((seg, i) => (
            <SegmentCard key={i} seg={seg} />
          ))}
        </div>
      )}

      {/* Linked activities */}
      {activities.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Logged {activities.length === 1 ? 'Activity' : 'Activities'}
          </h3>
          {activities.map(a => (
            <ActivityComparison key={a.id} activity={a} day={day} />
          ))}
        </div>
      )}

      {activities.length === 0 && (
        <div className="bg-gray-800/40 border border-gray-700 border-dashed rounded-xl p-4 text-center">
          <p className="text-sm text-gray-500">No activity logged for this day yet</p>
        </div>
      )}
    </div>
  );
}
