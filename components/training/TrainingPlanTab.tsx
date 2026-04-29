'use client';

import { useCallback, useEffect, useState } from 'react';
import { TrainingPlan, TrainingDay } from '@/lib/training-plans';
import BlockView from '@/components/training/BlockView';
import DayView from '@/components/training/DayView';
import EditPlanModal from '@/components/training/EditPlanModal';

interface PlanMeta { id: number; name: string; goal: string; created_at: string }

interface ActivitySummary {
  id: number; name: string; date: string; tss: number;
  moving_time: number; distance: number;
  average_watts: number | null;
  normalized_power: number | null;
  weighted_average_watts: number | null;
  average_heartrate: number | null;
  max_heartrate: number | null;
  intensity_factor: number | null;
}

type View = { type: 'block' } | { type: 'day'; day: TrainingDay };

/** Training Plan tab content (no page header — used inside the Training page tab bar). */
export default function TrainingPlanTab() {
  const [activePlanId, setActivePlanId] = useState<number | null>(null);
  const [plan, setPlan]                 = useState<TrainingPlan | null>(null);
  const [activities, setActivities]     = useState<ActivitySummary[]>([]);
  const [view, setView]                 = useState<View>({ type: 'block' });
  const [loadingPlan, setLoadingPlan]   = useState(true);
  const [editingPlan, setEditingPlan]   = useState(false);

  useEffect(() => {
    setLoadingPlan(true);
    fetch('/api/training/plans/active')
      .then(r => r.json())
      .then((data: { plans: PlanMeta[]; plan: TrainingPlan | null; activities: ActivitySummary[] }) => {
        if (data.plan) { setPlan(data.plan); setActivePlanId(data.plan.id); }
        if (data.activities) setActivities(data.activities);
      })
      .catch(console.error)
      .finally(() => setLoadingPlan(false));
  }, []);

  const loadPlan = useCallback((id: number) => {
    setLoadingPlan(true);
    fetch(`/api/training/plans/${id}`)
      .then(r => r.json() as Promise<TrainingPlan>)
      .then(data => {
        setPlan(data);
        setView({ type: 'block' });
        if (data.days?.length) {
          fetch(`/api/training/activities?from=${data.days[0].date}&to=${data.days[data.days.length - 1].date}`)
            .then(r => r.json()).then(setActivities).catch(console.error);
        }
      })
      .catch(console.error)
      .finally(() => setLoadingPlan(false));
  }, []);

  // Suppress unused warning — loadPlan is referenced by TrainingPlansSettings onSelect
  void activePlanId;

  const actsByDate = new Map<string, ActivitySummary[]>();
  for (const a of activities) {
    const arr = actsByDate.get(a.date) ?? [];
    arr.push(a);
    actsByDate.set(a.date, arr);
  }

  return (
    <div className="space-y-5">

      {/* Plan title + goal */}
      {plan && view.type === 'block' && (() => {
        const m = plan.name.match(/^(\d+)\s*[Ww]eeks?\s*[Pp]lan\s*[:\-–]\s*(.+)$/);
        const weekBadge = m ? `${m[1]}-Week Plan` : null;
        const title     = m ? m[2].trim() : plan.name;
        return (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {weekBadge && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-orange-500/15 text-orange-400 text-[11px] font-semibold uppercase tracking-wider mb-2">
                  {weekBadge}
                </span>
              )}
              <h2 className="text-2xl font-bold text-white leading-tight">{title}</h2>
              {plan.goal && <p className="text-base text-gray-400 mt-1.5 leading-snug">{plan.goal}</p>}
            </div>
            <button
              onClick={() => setEditingPlan(true)}
              className="flex-shrink-0 mt-1 px-3 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
            >
              Edit
            </button>
          </div>
        );
      })()}

      {/* No plan message */}
      {!loadingPlan && !plan && (
        <div className="bg-gray-800/40 border border-gray-700 border-dashed rounded-2xl p-8 text-center">
          <p className="text-sm text-gray-400">No active training plan.</p>
          <p className="text-xs text-gray-600 mt-1">Go to Training Plans to create or activate one.</p>
        </div>
      )}

      {loadingPlan && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => <div key={i} className="bg-gray-800 rounded-xl h-32 animate-pulse" />)}
        </div>
      )}

      {!loadingPlan && plan && (
        <>
          {view.type === 'block' && (
            <BlockView
              days={plan.days}
              activities={activities}
              onSelectDay={day => setView({ type: 'day', day })}
            />
          )}
          {view.type === 'day' && (
            <DayView
              day={view.day}
              activities={actsByDate.get(view.day.date) ?? []}
              onBack={() => setView({ type: 'block' })}
              onDayUpdated={() => { if (activePlanId) loadPlan(activePlanId); }}
            />
          )}
        </>
      )}

      {editingPlan && plan && (
        <EditPlanModal
          plan={plan}
          onClose={() => setEditingPlan(false)}
          onUpdated={() => { setEditingPlan(false); if (activePlanId) loadPlan(activePlanId); }}
        />
      )}
    </div>
  );
}
