'use client';

import { useEffect, useState, useCallback } from 'react';
import { TrainingPlan, TrainingDay } from '@/lib/training-plans';
import PlanSelector from './training/PlanSelector';
import BlockView from './training/BlockView';
import WeekView from './training/WeekView';
import DayView from './training/DayView';
import CreatePlanModal from './training/CreatePlanModal';

type View = { type: 'block' } | { type: 'week'; index: number } | { type: 'day'; day: TrainingDay };

interface PlanMeta {
  id: number;
  name: string;
  goal: string;
  created_at: string;
}

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
  max_heartrate: number | null;
  intensity_factor: number | null;
}

export default function TrainingPlanner() {
  const [plans, setPlans]           = useState<PlanMeta[]>([]);
  const [activePlanId, setActivePlanId] = useState<number | null>(null);
  const [plan, setPlan]             = useState<TrainingPlan | null>(null);
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [view, setView]             = useState<View>({ type: 'block' });
  const [showModal, setShowModal]   = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(false);

  // Load plan list on mount
  useEffect(() => {
    fetch('/api/training/plans')
      .then(r => r.json())
      .then((data: PlanMeta[]) => {
        setPlans(data);
        if (data.length > 0 && !activePlanId) {
          setActivePlanId(data[0].id);
        }
      })
      .catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load full plan when activePlanId changes
  useEffect(() => {
    if (!activePlanId) { setPlan(null); return; }
    setLoadingPlan(true);
    fetch(`/api/training/plans/${activePlanId}`)
      .then(r => r.json())
      .then((data: TrainingPlan) => { setPlan(data); setView({ type: 'block' }); })
      .catch(console.error)
      .finally(() => setLoadingPlan(false));
  }, [activePlanId]);

  // Fetch activities for the plan's date range
  const loadActivities = useCallback((days: TrainingDay[]) => {
    if (!days.length) return;
    const from = days[0].date;
    const to   = days[days.length - 1].date;
    fetch(`/api/training/activities?from=${from}&to=${to}`)
      .then(r => r.json())
      .then(setActivities)
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (plan?.days) loadActivities(plan.days);
  }, [plan, loadActivities]);

  function handleDeletePlan(id: number) {
    fetch(`/api/training/plans/${id}`, { method: 'DELETE' })
      .then(() => {
        const remaining = plans.filter(p => p.id !== id);
        setPlans(remaining);
        setActivePlanId(remaining.length > 0 ? remaining[0].id : null);
        setPlan(null);
      })
      .catch(console.error);
  }

  function handlePlanCreated(planId: number) {
    setShowModal(false);
    fetch('/api/training/plans')
      .then(r => r.json())
      .then((data: PlanMeta[]) => {
        setPlans(data);
        setActivePlanId(planId);
      })
      .catch(console.error);
  }

  // Activities indexed by date for child components
  const actsByDate = new Map<string, ActivitySummary[]>();
  for (const a of activities) {
    const arr = actsByDate.get(a.date) ?? [];
    arr.push(a);
    actsByDate.set(a.date, arr);
  }

  const weeks: TrainingDay[][] = [];
  if (plan?.days) {
    for (let i = 0; i < plan.days.length; i += 7) {
      weeks.push(plan.days.slice(i, i + 7));
    }
  }

  return (
    <div className="h-full overflow-y-auto scroll-touch">
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">

        {/* Plan selector */}
        <PlanSelector
          plans={plans}
          activePlanId={activePlanId}
          onSelect={id => { setActivePlanId(id); setView({ type: 'block' }); }}
          onNew={() => setShowModal(true)}
          onDelete={handleDeletePlan}
        />

        {/* Plan goal */}
        {plan && (
          <div className="text-sm text-gray-400">
            <span className="font-medium text-white">{plan.name}</span>
            {plan.goal && <> · {plan.goal}</>}
          </div>
        )}

        {/* Loading */}
        {loadingPlan && (
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-gray-800 rounded-xl h-32 animate-pulse" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loadingPlan && !plan && plans.length === 0 && (
          <div className="bg-gray-800/40 border border-gray-700 border-dashed rounded-2xl p-10 text-center space-y-3">
            <div className="text-4xl">📅</div>
            <h3 className="text-lg font-semibold text-white">No training plans yet</h3>
            <p className="text-sm text-gray-400">Generate a personalised plan with AI based on your profile and goals</p>
            <button
              onClick={() => setShowModal(true)}
              className="mt-2 px-5 py-2.5 bg-orange-500 hover:bg-orange-400 text-white rounded-xl text-sm font-medium transition-colors"
            >
              Generate a plan
            </button>
          </div>
        )}

        {/* Views */}
        {!loadingPlan && plan && (
          <>
            {view.type === 'block' && (
              <BlockView
                days={plan.days}
                activities={activities}
                onSelectWeek={wi => setView({ type: 'week', index: wi })}
              />
            )}

            {view.type === 'week' && (
              <WeekView
                days={weeks[view.index] ?? []}
                activities={activities.filter(a =>
                  (weeks[view.index] ?? []).some(d => d.date === a.date)
                )}
                onSelectDay={day => setView({ type: 'day', day })}
                onBack={() => setView({ type: 'block' })}
                weekIndex={view.index}
              />
            )}

            {view.type === 'day' && (
              <DayView
                day={view.day}
                activities={actsByDate.get(view.day.date) ?? []}
                onBack={() => {
                  // Go back to the week that contains this day
                  const wi = weeks.findIndex(w => w.some(d => d.date === view.day.date));
                  setView({ type: 'week', index: wi >= 0 ? wi : 0 });
                }}
              />
            )}
          </>
        )}

      </div>

      {showModal && (
        <CreatePlanModal
          onClose={() => setShowModal(false)}
          onCreated={handlePlanCreated}
        />
      )}
    </div>
  );
}
