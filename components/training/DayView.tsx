'use client';

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

function ActivityComparison({ activity, day }: { activity: ActivityDetail; day: TrainingDay }) {
  const np = activity.normalized_power ?? activity.weighted_average_watts;
  const mainSeg = day.segments.find(s => s.type === 'main');

  const comparisons = [];
  if (mainSeg?.target_np_watts && np) {
    const diff = Math.round(np) - mainSeg.target_np_watts;
    const pct = Math.round((np / mainSeg.target_np_watts - 1) * 100);
    comparisons.push({
      label: 'NP vs Target',
      actual: `${Math.round(np)}W`,
      target: `${mainSeg.target_np_watts}W`,
      diff: diff > 0 ? `+${diff}W (${pct}%)` : `${diff}W (${pct}%)`,
      ok: Math.abs(pct) <= 10,
    });
  }
  if (mainSeg?.target_avg_hr && activity.average_heartrate) {
    const diff = Math.round(activity.average_heartrate) - mainSeg.target_avg_hr;
    comparisons.push({
      label: 'Avg HR vs Target',
      actual: `${Math.round(activity.average_heartrate)} bpm`,
      target: `${mainSeg.target_avg_hr} bpm`,
      diff: diff > 0 ? `+${diff}` : `${diff}`,
      ok: Math.abs(diff) <= 10,
    });
  }

  return (
    <div className="bg-gray-800/60 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-green-500" />
        <h4 className="text-sm font-semibold text-green-400">{activity.name}</h4>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {activity.tss > 0 && (
          <div className="bg-gray-900/50 rounded-lg p-2">
            <p className="text-[10px] text-gray-500 uppercase mb-0.5">TSS</p>
            <p className="text-sm font-bold text-white">{activity.tss}</p>
            {day.tss_target && (
              <p className={`text-[10px] mt-0.5 ${Math.abs(activity.tss - day.tss_target) <= day.tss_target * 0.15 ? 'text-green-400' : 'text-yellow-400'}`}>
                target {day.tss_target}
              </p>
            )}
          </div>
        )}
        {np && (
          <div className="bg-gray-900/50 rounded-lg p-2">
            <p className="text-[10px] text-gray-500 uppercase mb-0.5">NP</p>
            <p className="text-sm font-bold text-white">{Math.round(np)}W</p>
          </div>
        )}
        {activity.average_watts && (
          <div className="bg-gray-900/50 rounded-lg p-2">
            <p className="text-[10px] text-gray-500 uppercase mb-0.5">Avg Power</p>
            <p className="text-sm font-bold text-white">{Math.round(activity.average_watts)}W</p>
          </div>
        )}
        {activity.average_heartrate && (
          <div className="bg-gray-900/50 rounded-lg p-2">
            <p className="text-[10px] text-gray-500 uppercase mb-0.5">Avg HR</p>
            <p className="text-sm font-bold text-white">{Math.round(activity.average_heartrate)} bpm</p>
          </div>
        )}
        {activity.max_heartrate && (
          <div className="bg-gray-900/50 rounded-lg p-2">
            <p className="text-[10px] text-gray-500 uppercase mb-0.5">Max HR</p>
            <p className="text-sm font-bold text-white">{Math.round(activity.max_heartrate)} bpm</p>
          </div>
        )}
        {activity.intensity_factor && (
          <div className="bg-gray-900/50 rounded-lg p-2">
            <p className="text-[10px] text-gray-500 uppercase mb-0.5">IF</p>
            <p className="text-sm font-bold text-white">{activity.intensity_factor.toFixed(2)}</p>
          </div>
        )}
        <div className="bg-gray-900/50 rounded-lg p-2">
          <p className="text-[10px] text-gray-500 uppercase mb-0.5">Duration</p>
          <p className="text-sm font-bold text-white">{fmt(activity.moving_time)}</p>
        </div>
      </div>

      {comparisons.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-gray-700/50">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider">vs Plan</p>
          {comparisons.map((c, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-gray-400">{c.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-gray-300">{c.actual} <span className="text-gray-600">/ {c.target}</span></span>
                <span className={c.ok ? 'text-green-400' : 'text-yellow-400'}>{c.diff}</span>
              </div>
            </div>
          ))}
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
