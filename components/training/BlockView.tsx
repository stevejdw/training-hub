'use client';

import { TrainingDay } from '@/lib/training-plans';

interface ActivitySummary {
  id: number;
  name: string;
  date: string;
  tss: number;
  moving_time: number;
  distance: number;
}

interface Props {
  days: TrainingDay[];
  activities: ActivitySummary[];
  onSelectWeek: (weekIndex: number) => void;
}

const TYPE_COLORS: Record<string, string> = {
  rest:       'bg-gray-700/50 text-gray-500',
  recovery:   'bg-blue-900/50 text-blue-400',
  endurance:  'bg-green-900/50 text-green-400',
  tempo:      'bg-yellow-900/50 text-yellow-400',
  threshold:  'bg-orange-900/50 text-orange-400',
  vo2max:     'bg-red-900/50 text-red-400',
  race:       'bg-purple-900/50 text-purple-400',
};

const TYPE_DOT: Record<string, string> = {
  rest:       'bg-gray-600',
  recovery:   'bg-blue-500',
  endurance:  'bg-green-500',
  tempo:      'bg-yellow-500',
  threshold:  'bg-orange-500',
  vo2max:     'bg-red-500',
  race:       'bg-purple-500',
};

function fmt(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h${m > 0 ? m + 'm' : ''}` : `${m}m`;
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function todaySydney(): string {
  const d = new Date(Date.now() + 10 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export default function BlockView({ days, activities, onSelectWeek }: Props) {
  if (!days.length) return null;

  const today = todaySydney();
  const actByDate = new Map<string, ActivitySummary[]>();
  for (const a of activities) {
    const arr = actByDate.get(a.date) ?? [];
    arr.push(a);
    actByDate.set(a.date, arr);
  }

  // Group days into weeks (7 at a time)
  const weeks: TrainingDay[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  return (
    <div className="space-y-4">
      {weeks.map((week, wi) => {
        const weekStart = week[0]?.date;
        const weekEnd = week[week.length - 1]?.date;
        const weekLabel = weekStart
          ? new Date(weekStart + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' }) +
            ' – ' +
            new Date(weekEnd + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
          : `Week ${wi + 1}`;

        const weekTss = week.reduce((s, d) => s + (d.tss_target ?? 0), 0);
        const hasActivity = week.some(d => (actByDate.get(d.date) ?? []).length > 0);
        const isCurrentWeek = week.some(d => d.date === today);

        return (
          <div
            key={wi}
            className={`bg-gray-800/60 rounded-xl overflow-hidden border transition-colors cursor-pointer hover:border-orange-500/50 ${
              isCurrentWeek ? 'border-orange-500/30' : 'border-gray-700/50'
            }`}
            onClick={() => onSelectWeek(wi)}
          >
            {/* Week header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700/50">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white">Week {wi + 1}</span>
                {isCurrentWeek && (
                  <span className="text-[10px] bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded px-1.5 py-0.5 font-medium">
                    Current
                  </span>
                )}
                {hasActivity && (
                  <span className="text-[10px] bg-green-500/20 text-green-400 border border-green-500/30 rounded px-1.5 py-0.5 font-medium">
                    Activities logged
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-400">
                <span>{weekLabel}</span>
                {weekTss > 0 && <span className="text-orange-400 font-medium">{weekTss} TSS</span>}
                <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>

            {/* Day cards */}
            <div className="grid grid-cols-7 gap-px bg-gray-700/20 p-px">
              {week.map((day, di) => {
                const acts = actByDate.get(day.date) ?? [];
                const isToday = day.date === today;
                const isPast = day.date < today;

                return (
                  <div
                    key={day.date}
                    className={`bg-gray-800/80 p-2 min-h-[80px] flex flex-col gap-1 ${
                      isToday ? 'ring-1 ring-orange-500/50 ring-inset' : ''
                    }`}
                  >
                    {/* Day label */}
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] font-medium ${isToday ? 'text-orange-400' : 'text-gray-500'}`}>
                        {DOW[di]}
                      </span>
                      <span className={`text-[10px] ${isToday ? 'text-orange-400' : 'text-gray-600'}`}>
                        {new Date(day.date + 'T00:00:00Z').getUTCDate()}
                      </span>
                    </div>

                    {day.type !== 'rest' ? (
                      <>
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${TYPE_DOT[day.type] ?? 'bg-gray-500'}`} />
                        <p className="text-[10px] text-gray-300 leading-tight line-clamp-2">{day.title}</p>
                        {day.duration_min > 0 && (
                          <span className="text-[10px] text-gray-500">{fmt(day.duration_min * 60)}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-[10px] text-gray-600 italic">Rest</span>
                    )}

                    {acts.length > 0 && (
                      <div className="mt-auto">
                        {acts.map(a => (
                          <div key={a.id} className="flex items-center gap-1 mt-0.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                            <span className={`text-[9px] ${isPast || isToday ? 'text-green-400' : 'text-gray-500'} truncate`}>
                              {a.tss > 0 ? `${a.tss} TSS` : fmt(a.moving_time)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Legend */}
      <div className="flex gap-3 flex-wrap px-1">
        {Object.entries(TYPE_COLORS).filter(([k]) => k !== 'rest').map(([type, cls]) => (
          <div key={type} className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${TYPE_DOT[type]}`} />
            <span className="text-[10px] text-gray-500 capitalize">{type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
