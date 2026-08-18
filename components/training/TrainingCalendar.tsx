'use client';

import Link from 'next/link';
import { useCachedFetch } from '@/lib/use-cached-fetch';

interface ActivityDay {
  id:         number;
  name:       string;
  sport_type: string;
  km:         number;
  hours:      number;
  tss:        number;
}

interface PlanDay {
  title:      string;
  type:       string;
  tss_target: number | null;
}

interface CalendarDay {
  date:         string;
  isToday:      boolean;
  isFuture:     boolean;
  activities:   ActivityDay[];
  plan:         PlanDay | null;
  match_status: 'match' | 'extra' | 'missed' | null;
}

interface CalendarWeek {
  week_start: string;
  days:       CalendarDay[];
  totals:     { km: number; hours: number; tss: number; activities: number };
}

interface CalendarResponse {
  weeks: CalendarWeek[];
  today: string;
}

const DOW_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Small sport icon rendered inside the day circle. */
function SportIcon({ sportType }: { sportType: string }) {
  if (sportType === 'Run' || sportType === 'Walk' || sportType === 'Hike') {
    return (
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3 9l2-6m0 0l2 6m-2-6V9m-3 5l-2 2m8-2l2 2" />
      </svg>
    );
  }
  if (sportType === 'Swim') {
    return (
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
      </svg>
    );
  }
  if (sportType === 'WeightTraining' || sportType === 'Yoga') {
    return (
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 8h4m12 0h-4M4 16h4m12 0h-4M8 8v8m8-8v8" />
      </svg>
    );
  }
  // Default: bike icon
  return (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="6" cy="15" r="3" />
      <circle cx="18" cy="15" r="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 15l4-8 2 3h4l-3 5" />
    </svg>
  );
}

function DayCell({ day }: { day: CalendarDay }) {
  const hasAct  = day.activities.length > 0;
  const act     = day.activities[0]; // show first activity's icon

  // Dot color based on match status
  const dotCls =
    day.match_status === 'match'  ? 'bg-green-500'  :
    day.match_status === 'extra'  ? 'bg-amber-500'  :
    day.match_status === 'missed' ? 'bg-gray-600'   : '';

  const cellContent = (
    <div className={`relative flex flex-col items-center gap-0.5 ${day.isFuture ? 'opacity-30' : ''}`}>
      {/* Circle with sport icon */}
      <div className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
        hasAct
          ? day.match_status === 'match' ? 'bg-green-500/20 text-green-400 ring-1 ring-green-500/40'
          : day.match_status === 'extra' ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40'
          : 'bg-accent/20 text-accent-hi ring-1 ring-accent/30'
          : day.plan
          ? 'bg-hover/40 text-ink-5 ring-1 ring-dashed ring-line-strong'
          : day.isToday
          ? 'ring-1 ring-accent/60 text-ink-5'
          : 'text-raised'
      }`}>
        {hasAct && <SportIcon sportType={act.sport_type} />}
        {!hasAct && day.plan && (
          <svg className="w-2.5 h-2.5 text-ink-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        )}
      </div>

      {/* Status dot */}
      {dotCls && (
        <span className={`w-1.5 h-1.5 rounded-full ${dotCls}`} />
      )}
      {!dotCls && <span className="w-1.5 h-1.5" />}

      {/* Today ring */}
      {day.isToday && (
        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent" />
      )}
    </div>
  );

  if (!hasAct) return <div className="flex-1 flex justify-center">{cellContent}</div>;

  // Clickable if has activity
  const href = act ? `/activities/${act.id}` : '#';
  return (
    <Link href={href} className="flex-1 flex justify-center hover:opacity-80 active:opacity-60 transition-opacity">
      {cellContent}
    </Link>
  );
}

function WeekRow({ week }: { week: CalendarWeek }) {
  const { totals } = week;
  const hasAny = totals.activities > 0;

  // Short month label for week_start
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [,wm, wd] = week.week_start.split('-').map(Number);
  const weekLabel = `${M[wm-1]} ${wd}`;

  return (
    <div className="grid grid-cols-[48px_repeat(7,1fr)_56px] gap-0 items-center border-b border-line/60 last:border-b-0">
      {/* Week label */}
      <div className="py-2 pr-1 text-micro text-ink-5 font-medium leading-tight text-right">{weekLabel}</div>

      {/* Day cells */}
      {week.days.map(day => (
        <div key={day.date} className="py-2 flex justify-center">
          <DayCell day={day} />
        </div>
      ))}

      {/* Row totals */}
      <div className="py-2 pl-1 text-micro text-ink-4 leading-tight text-right">
        {hasAny ? (
          <>
            <div className="text-ink-3 font-medium">{totals.km}k</div>
            <div>{totals.hours}h</div>
            {totals.tss > 0 && <div className="text-ink-5">{totals.tss}</div>}
          </>
        ) : (
          <span className="text-raised">—</span>
        )}
      </div>
    </div>
  );
}

interface Props {
  /** Number of weeks to display (default 8) */
  numWeeks?: number;
}

export default function TrainingCalendar({ numWeeks = 8 }: Props) {
  const { data, loading } = useCachedFetch<CalendarResponse>(
    `/api/training/calendar?weeks=${numWeeks}`,
    `cache-training-calendar-${numWeeks}`,
  );

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-4 px-0.5">
        Training Calendar
      </h3>

      {/* Legend */}
      <div className="flex items-center gap-4 text-micro text-ink-4">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
          Followed plan
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
          Trained, no plan
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-gray-600 inline-block" />
          Missed
        </span>
      </div>

      <div className="bg-surface border border-line rounded-2xl overflow-hidden">
        {/* Header row */}
        <div className="grid grid-cols-[48px_repeat(7,1fr)_56px] gap-0 border-b border-line bg-page/60">
          <div />
          {DOW_LABELS.map((d, i) => (
            <div key={i} className="py-1.5 text-micro font-semibold uppercase tracking-wider text-ink-5 text-center">
              {d}
            </div>
          ))}
          <div className="py-1.5 text-micro font-semibold uppercase tracking-wider text-ink-5 text-right pr-1">
            Totals
          </div>
        </div>

        {/* Week rows */}
        {loading && !data ? (
          <div className="divide-y divide-line/60">
            {Array.from({ length: numWeeks }).map((_, i) => (
              <div key={i} className="grid grid-cols-[48px_repeat(7,1fr)_56px] gap-0 py-2 animate-pulse">
                <div />
                {Array.from({ length: 7 }).map((_, j) => (
                  <div key={j} className="flex justify-center">
                    <div className="w-7 h-7 rounded-full bg-raised" />
                  </div>
                ))}
                <div />
              </div>
            ))}
          </div>
        ) : data?.weeks?.length ? (
          data.weeks.map(week => <WeekRow key={week.week_start} week={week} />)
        ) : (
          <div className="px-4 py-6 text-center text-sm text-ink-4">
            No training data yet.
          </div>
        )}
      </div>
    </div>
  );
}
