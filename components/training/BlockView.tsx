'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
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
  onDaysChanged?: () => void;
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

const TYPE_BADGE: Record<string, string> = {
  rest:       'bg-gray-700/60 text-gray-400',
  recovery:   'bg-blue-900/60 text-blue-400',
  endurance:  'bg-green-900/60 text-green-400',
  tempo:      'bg-yellow-900/60 text-yellow-400',
  threshold:  'bg-orange-900/60 text-orange-400',
  vo2max:     'bg-red-900/60 text-red-400',
  race:       'bg-purple-900/60 text-purple-400',
};

const DOW_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function todaySydney(): string {
  const d = new Date(Date.now() + 10 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function fmtMins(mins: number): string {
  if (!mins) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

function fmtActTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

function completionStatus(day: TrainingDay, acts: ActivitySummary[]): 'done' | 'logged' | 'none' {
  if (acts.length === 0) return 'none';
  const best = acts.reduce((a, b) => (b.tss > a.tss || b.moving_time > a.moving_time ? b : a));
  if (day.tss_target && day.tss_target > 0 && best.tss > 0) {
    return Math.abs(best.tss - day.tss_target) / day.tss_target <= 0.15 ? 'done' : 'logged';
  }
  if (day.duration_min > 0 && best.moving_time > 0) {
    return Math.abs(best.moving_time - day.duration_min * 60) / (day.duration_min * 60) <= 0.20 ? 'done' : 'logged';
  }
  return 'done';
}

// ─── Swipeable wrapper ────────────────────────────────────────────────────────

const SWIPE_OPEN_PX = -88; // how far the card slides to reveal the delete button

function SwipeableCard({
  day,
  isToday,
  isRest,
  isPast,
  children,
  onDelete,
}: {
  day: TrainingDay;
  isToday: boolean;
  isRest: boolean;
  isPast: boolean;
  children: React.ReactNode;
  onDelete: (day: TrainingDay) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const startX = useRef(0);
  const startOffset = useRef(0);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startOffset.current = isOpen ? SWIPE_OPEN_PX : 0;
    setDragging(true);
    setDragOffset(startOffset.current);
  }, [isOpen]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const diff = e.touches[0].clientX - startX.current;
    setDragOffset(Math.min(0, Math.max(SWIPE_OPEN_PX, startOffset.current + diff)));
  }, []);

  const onTouchEnd = useCallback(() => {
    setDragging(false);
    // Snap open if past halfway, else snap closed
    setIsOpen(dragOffset < SWIPE_OPEN_PX / 2);
    setDragOffset(0);
  }, [dragOffset]);

  const translateX = dragging ? dragOffset : (isOpen ? SWIPE_OPEN_PX : 0);

  const showDeleteUI = dragging || isOpen;

  return (
    <div className="relative overflow-hidden rounded-xl">
      {/* Delete button revealed only while swiping / when open */}
      {showDeleteUI && (
        <div className="absolute inset-0 flex items-center justify-end rounded-xl bg-red-600">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false);
              setDragOffset(0);
              onDelete(day);
            }}
            className="w-[88px] h-full flex flex-col items-center justify-center gap-1 text-white active:bg-red-700 rounded-r-xl"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span className="text-xs font-semibold">Delete</span>
          </button>
        </div>
      )}

      {/* Sliding card */}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          transform: `translateX(${translateX}px)`,
          transition: dragging ? 'none' : 'transform 0.3s ease',
        }}
        className={`relative rounded-xl border ${
          isToday
            ? 'border-orange-500/50 bg-gray-800/80'
            : isRest
            ? 'border-gray-800 bg-gray-900/40'
            : 'border-gray-800 bg-gray-800/60'
        }`}
      >
        {children}
        {/* Transparent overlay when open: tapping anywhere on the card closes it */}
        {isOpen && (
          <div
            className="absolute inset-0 z-10 rounded-xl"
            onClick={() => setIsOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Day card that is both a drop target and contains draggable content ──────

function DayCard({
  day,
  acts,
  status,
  isToday,
  isPast,
  isRest,
  di,
  dateNum,
  onSelectDay,
  onDelete,
  onDropOnDay,
}: {
  day: TrainingDay;
  acts: ActivitySummary[];
  status: 'done' | 'logged' | 'none';
  isToday: boolean;
  isPast: boolean;
  isRest: boolean;
  di: number;
  dateNum: number;
  onSelectDay: (day: TrainingDay) => void;
  onDelete: (day: TrainingDay) => void;
  onDropOnDay: (dayId: number, targetDayId: number) => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  // ── Drag over handlers (make this a drop target) ──
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (dragCounter.current === 1) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragOver(false);
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.dayId !== day.id) {
        onDropOnDay(data.dayId, day.id);
      }
    } catch {
      // ignore invalid drops
    }
  }, [day.id, onDropOnDay]);

  // ── Drag start (make this draggable) ──
  const handleDragStart = useCallback((e: React.DragEvent) => {
    if (isRest) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('application/json', JSON.stringify({ dayId: day.id }));
    e.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
  }, [day, isRest]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <SwipeableCard day={day} isToday={isToday} isRest={isRest} isPast={isPast} onDelete={onDelete}>
      <div
        // Drop target events on the outer wrapper
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`rounded-xl transition-all duration-150 ${
          isDragOver
            ? 'ring-2 ring-orange-500 bg-orange-500/10'
            : ''
        }`}
      >
        <div
          // Drag source events on the inner content
          draggable={!isRest}
          onDragStart={!isRest ? handleDragStart : undefined}
          onDragEnd={handleDragEnd}
          onClick={() => !isRest && !isDragging && onSelectDay(day)}
          className={`${isDragging ? 'opacity-50' : ''}`}
        >
          <div className="flex items-start gap-3 px-4 py-3">

            {/* Grab handle + Day label column */}
            <div className="flex-shrink-0 w-12 text-center pt-0.5">
              {!isRest && (
                <div className="flex justify-center mb-1 cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-400 transition-colors">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm8 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM8 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm8 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM8 22a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm8 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" />
                  </svg>
                </div>
              )}
              <p className={`text-xs font-semibold ${isToday ? 'text-orange-400' : 'text-gray-400'}`}>
                {DOW_SHORT[di]}
              </p>
              <p className={`text-lg font-bold leading-tight ${isToday ? 'text-orange-400' : isPast ? 'text-gray-600' : 'text-gray-300'}`}>
                {dateNum}
              </p>
            </div>

            {/* Divider */}
            <div className={`w-px self-stretch mx-1 flex-shrink-0 ${isToday ? 'bg-orange-500/40' : 'bg-gray-700'}`} />

            {/* Content */}
            <div className="flex-1 min-w-0">
              {isRest ? (
                <div className="flex items-center gap-2 py-1">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${TYPE_DOT.rest}`} />
                  <span className="text-sm text-gray-500 italic">Rest day</span>
                </div>
              ) : (
                <>
                  {/* Title row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${TYPE_DOT[day.type] ?? 'bg-gray-500'} ${isPast && status === 'none' ? 'opacity-40' : ''}`} />
                      <p className={`text-sm font-semibold leading-snug ${isPast && status === 'none' ? 'text-gray-500' : 'text-white'}`}>
                        {day.title}
                      </p>
                    </div>
                    {/* Status tick */}
                    {status === 'done' && (
                      <svg className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {status === 'logged' && (
                      <svg className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>

                  {/* Meta row: type badge + duration + TSS */}
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className={`text-[10px] rounded px-1.5 py-0.5 capitalize font-medium ${TYPE_BADGE[day.type] ?? TYPE_BADGE.endurance}`}>
                      {day.type}
                    </span>
                    {day.duration_min > 0 && (
                      <span className="text-[11px] text-gray-500">{fmtMins(day.duration_min)}</span>
                    )}
                    {day.tss_target && day.tss_target > 0 && (
                      <span className="text-[11px] text-orange-400/70">{day.tss_target} TSS</span>
                    )}
                  </div>

                  {/* Description snippet */}
                  {day.description && (
                    <p className={`text-xs mt-1.5 line-clamp-2 leading-relaxed ${isPast && status === 'none' ? 'text-gray-600' : 'text-gray-400'}`}>
                      {day.description}
                    </p>
                  )}

                  {/* Logged activities */}
                  {acts.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {acts.map(a => (
                        <div key={a.id} className="flex items-center gap-1.5">
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${status === 'done' ? 'bg-green-500' : 'bg-yellow-500'}`} />
                          <span className={`text-[11px] truncate ${status === 'done' ? 'text-green-400' : 'text-yellow-400'}`}>
                            {a.name}
                          </span>
                          <span className="text-[10px] text-gray-600 flex-shrink-0 ml-auto">
                            {a.tss > 0 ? `${a.tss} TSS` : fmtActTime(a.moving_time)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Chevron for non-rest days */}
            {!isRest && (
              <svg className="w-4 h-4 text-gray-600 flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            )}
          </div>
        </div>
      </div>
    </SwipeableCard>
  );
}

// ─── Main BlockView ──────────────────────────────────────────────────────────

export default function BlockView({ days, activities, onSelectDay, onDaysChanged }: Props) {
  const today = todaySydney();

  // Group into weeks of 7
  const weeks: TrainingDay[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  // Default to the current week, else week 0
  const defaultIdx = weeks.findIndex(w => w.some(d => d.date === today));
  const [weekIdx, setWeekIdx] = useState(defaultIdx >= 0 ? defaultIdx : 0);

  // If days prop changes (new plan loaded), reset to current week
  useEffect(() => {
    const idx = weeks.findIndex(w => w.some(d => d.date === today));
    setWeekIdx(idx >= 0 ? idx : 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  if (!weeks.length) return null;

  // Safety: clamp weekIdx to valid range
  const safeWeekIdx = Math.min(weekIdx, weeks.length - 1);
  const week = weeks[safeWeekIdx] ?? [];
  const actByDate = new Map<string, ActivitySummary[]>();
  for (const a of activities) {
    const arr = actByDate.get(a.date) ?? [];
    arr.push(a);
    actByDate.set(a.date, arr);
  }

  const weekStart = week[0]?.date ?? '';
  const weekEnd   = week[week.length - 1]?.date ?? '';
  const weekTss   = week.reduce((s, d) => s + (d.tss_target ?? 0), 0);
  const weekMins  = week.reduce((s, d) => s + (d.duration_min ?? 0), 0);
  const isCurrentWeek = week.some(d => d.date === today);

  const nonRestDays = week.filter(d => d.type !== 'rest');
  const doneDays    = nonRestDays.filter(d => completionStatus(d, actByDate.get(d.date) ?? []) === 'done').length;

  const weekLabel = weekStart
    ? new Date(weekStart + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' }) +
      ' – ' +
      new Date(weekEnd + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    : `Week ${weekIdx + 1}`;

  // ── Move day handler with swap support ──
  const handleDropOnDay = useCallback(async (draggedDayId: number, targetDayId: number) => {
    try {
      const draggedDay = days.find(d => d.id === draggedDayId);
      const targetDay = days.find(d => d.id === targetDayId);
      if (!draggedDay || !targetDay) throw new Error('Day not found');

      const draggedDate = draggedDay.date;
      const targetDate = targetDay.date;

      if (targetDay.type === 'rest') {
        // Just move the dragged session to the target date
        const res = await fetch(`/api/training/days/${draggedDayId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: targetDate }),
        });
        if (!res.ok) throw new Error('Move failed');
      } else {
        // Swap: move dragged day to target date, move target day to dragged day's date
        const res1 = await fetch(`/api/training/days/${draggedDayId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: targetDate }),
        });
        if (!res1.ok) throw new Error('Swap step 1 failed');

        const res2 = await fetch(`/api/training/days/${targetDayId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: draggedDate }),
        });
        if (!res2.ok) throw new Error('Swap step 2 failed');
      }
      onDaysChanged?.();
    } catch (err) {
      console.error('Move day error:', err);
    }
  }, [days, onDaysChanged]);

  // ── Delete day handler: convert to a rest day so other days keep their dates ──
  const handleDeleteDay = useCallback(async (day: TrainingDay) => {
    try {
      const res = await fetch(`/api/training/days/${day.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'rest',
          title: 'Rest day',
          duration_min: 0,
          tss_target: null,
          description: '',
          segments: [],
        }),
      });
      if (!res.ok) throw new Error('Delete failed');
      onDaysChanged?.();
    } catch (err) {
      console.error('Delete day error:', err);
    }
  }, [onDaysChanged]);

  return (
    <div className="space-y-3">

      {/* Week navigation */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setWeekIdx(i => Math.max(0, i - 1))}
          disabled={weekIdx === 0}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="flex-1 text-center">
          <div className="flex items-center justify-center gap-2">
            <span className="text-sm font-semibold text-white">Week {weekIdx + 1}</span>
            {isCurrentWeek && (
              <span className="text-[10px] bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded px-1.5 py-0.5 font-medium">Current</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{weekLabel}</p>
        </div>

        <button
          onClick={() => setWeekIdx(i => Math.min(weeks.length - 1, i + 1))}
          disabled={weekIdx === weeks.length - 1}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Week summary strip */}
      <div className="flex items-center gap-3 px-1 text-xs text-gray-500">
        {doneDays > 0 && (
          <span className="text-green-400 font-medium">{doneDays}/{nonRestDays.length} done</span>
        )}
        {weekMins > 0 && <span>{fmtMins(weekMins)} planned</span>}
        {weekTss > 0  && <span className="text-orange-400">{weekTss} TSS planned</span>}
        <span className="ml-auto text-gray-600">{weekIdx + 1} / {weeks.length}</span>
      </div>

      {/* Drag hint */}
      <p className="text-[10px] text-gray-600 text-center">
        Use the grip handle to drag a session to a different day · Swipe left to delete
      </p>

      {/* Day cards — no separate drop zones, each card IS a drop target */}
      <div className="space-y-2">
        {week.map((day, di) => {
          const acts    = actByDate.get(day.date) ?? [];
          const status  = completionStatus(day, acts);
          const isToday = day.date === today;
          const isPast  = day.date < today;
          const isRest  = day.type === 'rest';
          const dateNum = new Date(day.date + 'T00:00:00Z').getUTCDate();

          return (
            <DayCard
              key={day.id}
              day={day}
              acts={acts}
              status={status}
              isToday={isToday}
              isPast={isPast}
              isRest={isRest}
              di={di}
              dateNum={dateNum}
              onSelectDay={onSelectDay}
              onDelete={handleDeleteDay}
              onDropOnDay={handleDropOnDay}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-3 flex-wrap px-1 pt-1 items-center">
        {Object.entries(TYPE_DOT).filter(([k]) => k !== 'rest').map(([type, cls]) => (
          <div key={type} className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${cls}`} />
            <span className="text-[10px] text-gray-500 capitalize">{type}</span>
          </div>
        ))}
        <div className="flex items-center gap-3 ml-2 pl-2 border-l border-gray-700">
          <div className="flex items-center gap-1">
            <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            <span className="text-[10px] text-gray-500">On target</span>
          </div>
          <div className="flex items-center gap-1">
            <svg className="w-3 h-3 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            <span className="text-[10px] text-gray-500">Off target</span>
          </div>
        </div>
      </div>

    </div>
  );
}
