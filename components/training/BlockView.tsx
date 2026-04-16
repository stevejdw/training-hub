'use client';

import { TrainingDay } from '@/lib/training-plans';

interface ActivitySummary {
  id: number;
  name: string;
  date: string;
  tss: number;
  moving_time: number;
}

interface Props {
  days: TrainingDay[];
  activities: ActivitySummary[];
  onSelectDay: (day: TrainingDay) => void;
}

const TYPE_DOT: Record<string, string> = {
  rest:       'bg-gray-600',
  recovery:   'bg-blue-500',
  endurance:  'bg-green-500',
  tempo:      'bg-yellow-500',
  threshold:  'bg-orange-500',
  vo2max:     'bg-red-500',
  race:       'bg-purple-500',
};

function fmtMins(mins: number): string {
  if (!mins) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? (m > 0 ? `${h}h${m}m` : `${h}h`) : `${m}m`;
}

function fmtActTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? (m > 0 ? `${h}h${m}m` : `${h}h`) : `${m}m`;
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function todaySydney(): string {
  const d = new Date(Date.now() + 10 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export default function BlockView({ days, activities, onSelectDay }: Props) {
  if (!days.length) return null;

  const today = todaySydney();
  const actByDate = new Map<string, ActivitySummary[]>();
  for (const a of activities) {
    const arr = actByDate.get(a.date) ?? [];
    arr.push(a);
    actByDate.set(a.date, arr);
  }

  // Group into weeks
  const weeks: TrainingDay[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    <div className="space-y-4">
      {weeks.map((week, wi) => {
        const weekStart = week[0]?.date;
        const weekEnd   = week[week.length - 1]?.date;
        const weekLabel = weekStart
          ? new Date(weekStart + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' }) +
            ' – ' +
            new Date(weekEnd   + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
          : `Week ${wi + 1}`;

        const weekTss    = week.reduce((s, d) => s + (d.tss_target ?? 0), 0);
        const weekMins   = week.reduce((s, d) => s + (d.duration_min ?? 0), 0);
        const hasActivity = week.some(d => (actByDate.get(d.date) ?? []).length > 0);
        const isCurrentWeek = week.some(d => d.date === today);

        return (
          <div
            key={wi}
            className={`bg-gray-800/60 rounded-xl overflow-hidden border ${
              isCurrentWeek ? 'border-orange-500/30' : 'border-gray-700/50'
            }`}
          >
            {/* Week header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700/50">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white">Week {wi + 1}</span>
                {isCurrentWeek && (
                  <span className="text-[10px] bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded px-1.5 py-0.5 font-medium">Current</span>
                )}
                {hasActivity && (
                  <span className="text-[10px] bg-green-500/20 text-green-400 border border-green-500/30 rounded px-1.5 py-0.5 font-medium">Logged</span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-400">
                <span className="hidden sm:block">{weekLabel}</span>
                {weekMins > 0 && <span className="text-gray-300 font-medium">{fmtMins(weekMins)}</span>}
                {weekTss > 0  && <span className="text-orange-400 font-medium">{weekTss} TSS</span>}
              </div>
            </div>

            {/* Day cards grid */}
            <div className="grid grid-cols-7 gap-px bg-gray-700/20 p-px">
              {week.map((day, di) => {
                const acts    = actByDate.get(day.date) ?? [];
                const isToday = day.date === today;
                const isRest  = day.type === 'rest';
                const clickable = !isRest;

                return (
                  <div
                    key={day.date}
                    onClick={() => clickable && onSelectDay(day)}
                    className={`bg-gray-800/80 p-2 min-h-[88px] flex flex-col gap-1 transition-colors ${
                      isToday ? 'ring-1 ring-orange-500/50 ring-inset' : ''
                    } ${clickable ? 'cursor-pointer hover:bg-gray-700/80' : ''}`}
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

                    {!isRest ? (
                      <>
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${TYPE_DOT[day.type] ?? 'bg-gray-500'}`} />
                        <p className="text-[10px] text-gray-300 leading-tight line-clamp-2 flex-1">{day.title}</p>
                        {day.duration_min > 0 && (
                          <span className="text-[10px] text-gray-500">{fmtMins(day.duration_min)}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-[10px] text-gray-600 italic mt-1">Rest</span>
                    )}

                    {acts.length > 0 && (
                      <div className="mt-auto space-y-0.5">
                        {acts.map(a => (
                          <div key={a.id} className="flex items-center gap-1">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                            <span className="text-[9px] text-green-400 truncate">
                              {a.tss > 0 ? `${a.tss} TSS` : fmtActTime(a.moving_time)}
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
        {Object.entries(TYPE_DOT).filter(([k]) => k !== 'rest').map(([type, cls]) => (
          <div key={type} className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${cls}`} />
            <span className="text-[10px] text-gray-500 capitalize">{type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
