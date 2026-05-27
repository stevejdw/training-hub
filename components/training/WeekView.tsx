'use client';

import { TrainingDay } from '@/lib/training-plans';

interface ActivitySummary {
  id: number;
  name: string;
  date: string;
  tss: number;
  moving_time: number;
  distance: number;
  average_watts: number | null;
  normalized_power: number | null;
  weighted_average_watts: number | null;
  average_heartrate: number | null;
}

interface Props {
  days: TrainingDay[];
  activities: ActivitySummary[];
  onSelectDay: (day: TrainingDay) => void;
  onBack: () => void;
  weekIndex: number;
}

const TYPE_COLORS: Record<string, string> = {
  rest:       'border-gray-700 bg-gray-800/40',
  recovery:   'border-blue-800/50 bg-blue-900/20',
  endurance:  'border-green-800/50 bg-green-900/20',
  tempo:      'border-yellow-800/50 bg-yellow-900/20',
  threshold:  'border-orange-800/50 bg-orange-900/20',
  vo2max:     'border-red-800/50 bg-red-900/20',
  race:       'border-purple-800/50 bg-purple-900/20',
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

const DOW = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function todaySydney(): string {
  const d = new Date(Date.now() + 10 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export default function WeekView({ days, activities, onSelectDay, onBack, weekIndex }: Props) {
  const today = todaySydney();
  const actByDate = new Map<string, ActivitySummary[]>();
  for (const a of activities) {
    const arr = actByDate.get(a.date) ?? [];
    arr.push(a);
    actByDate.set(a.date, arr);
  }

  const weekTss = days.reduce((s, d) => s + (d.tss_target ?? 0), 0);
  const weekStart = days[0]?.date;
  const weekEnd = days[days.length - 1]?.date;
  const weekLabel = weekStart
    ? new Date(weekStart + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'long', timeZone: 'UTC' }) +
      ' – ' +
      new Date(weekEnd + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : '';

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h2 className="text-base font-semibold text-white">Week {weekIndex + 1}</h2>
          <p className="text-xs text-gray-400">{weekLabel}{weekTss > 0 ? ` · ${weekTss} TSS` : ''}</p>
        </div>
      </div>

      {/* Day list */}
      {days.map((day, di) => {
        const acts = actByDate.get(day.date) ?? [];
        const isToday = day.date === today;
        const isRest = day.type === 'rest';
        const np = acts[0]?.normalized_power ?? acts[0]?.weighted_average_watts;

        return (
          <div
            key={day.date}
            onClick={() => !isRest && onSelectDay(day)}
            className={`rounded-xl border p-4 transition-colors ${TYPE_COLORS[day.type] ?? TYPE_COLORS.endurance} ${
              !isRest ? 'cursor-pointer hover:brightness-110' : ''
            } ${isToday ? 'ring-1 ring-orange-500/50' : ''}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs font-medium text-gray-400">{DOW[di]}</span>
                  <span className="text-xs text-gray-500">
                    {new Date(day.date + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}
                  </span>
                  {isToday && (
                    <span className="text-[10px] bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded px-1.5 py-0.5">Today</span>
                  )}
                  <span className={`text-[10px] rounded px-1.5 py-0.5 capitalize font-medium ${TYPE_BADGE[day.type] ?? TYPE_BADGE.endurance}`}>
                    {day.type}
                  </span>
                </div>

                {isRest ? (
                  <p className="text-sm text-gray-500 italic">Rest day</p>
                ) : (
                  <>
                    <h3 className="text-sm font-semibold text-white mb-0.5">{day.title}</h3>
                    <p className="text-xs text-gray-400 line-clamp-2">{day.description}</p>
                    <div className="flex gap-3 mt-2 flex-wrap">
                      {day.duration_min > 0 && (
                        <span className="text-xs text-gray-400">{fmt(day.duration_min * 60)}</span>
                      )}
                      {day.tss_target && (
                        <span className="text-xs text-orange-400">{day.tss_target} TSS</span>
                      )}
                      {day.segments.length > 0 && (
                        <span className="text-xs text-gray-500">{day.segments.length} segments</span>
                      )}
                    </div>
                  </>
                )}
              </div>

              {!isRest && (
                <svg className="w-4 h-4 text-gray-600 flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              )}
            </div>

            {/* Linked activities */}
            {acts.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-700/50 space-y-1">
                {acts.map(a => (
                  <div key={a.id} className="flex items-center gap-2 text-xs">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                    <span className="text-green-400 font-medium truncate">{a.name}</span>
                    <span className="text-gray-500 ml-auto flex-shrink-0">
                      {a.tss > 0 ? `${a.tss} TSS` : ''}
                      {np ? ` · ${Math.round(np)}W NP` : ''}
                      {a.average_heartrate ? ` · ${Math.round(a.average_heartrate)} bpm` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
