'use client';

import { useEffect, useState, useCallback } from 'react';
import { TrainingPlan, TrainingDay } from '@/lib/training-plans';
import PlanSelector from './training/PlanSelector';
import BlockView from './training/BlockView';
import DayView from './training/DayView';
import CreatePlanModal from './training/CreatePlanModal';
import EditPlanModal from './training/EditPlanModal';

type View = { type: 'block' } | { type: 'day'; day: TrainingDay };

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
  const [plans, setPlans]             = useState<PlanMeta[]>([]);
  const [activePlanId, setActivePlanId] = useState<number | null>(null);
  const [plan, setPlan]               = useState<TrainingPlan | null>(null);
  const [activities, setActivities]   = useState<ActivitySummary[]>([]);
  const [view, setView]               = useState<View>({ type: 'block' });
  const [showCreate, setShowCreate]   = useState(false);
  const [showEdit, setShowEdit]       = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(false);

  const fetchPlans = useCallback(() =>
    fetch('/api/training/plans')
      .then(r => r.json())
      .then((data: PlanMeta[]) => {
        setPlans(data);
        return data;
      })
      .catch(console.error), []);

  useEffect(() => {
    fetchPlans().then(data => {
      if (data && data.length > 0 && !activePlanId) setActivePlanId(data[0].id);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPlan = useCallback((id: number) => {
    setLoadingPlan(true);
    fetch(`/api/training/plans/${id}`)
      .then(r => r.json())
      .then((data: TrainingPlan) => { setPlan(data); setView({ type: 'block' }); })
      .catch(console.error)
      .finally(() => setLoadingPlan(false));
  }, []);

  useEffect(() => {
    if (!activePlanId) { setPlan(null); return; }
    loadPlan(activePlanId);
  }, [activePlanId, loadPlan]);

  const loadActivities = useCallback((days: TrainingDay[]) => {
    if (!days.length) return;
    fetch(`/api/training/activities?from=${days[0].date}&to=${days[days.length - 1].date}`)
      .then(r => r.json())
      .then(setActivities)
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (plan?.days) loadActivities(plan.days);
  }, [plan, loadActivities]);

  function handleDeletePlan(id: number) {
    fetch(`/api/training/plans/${id}`, { method: 'DELETE' })
      .then(() => fetchPlans())
      .then(data => {
        const remaining = (data as PlanMeta[] | undefined) ?? [];
        setActivePlanId(remaining.length > 0 ? remaining[0].id : null);
        if (!remaining.length) setPlan(null);
      })
      .catch(console.error);
  }

  function handlePlanCreated(planId: number) {
    setShowCreate(false);
    fetchPlans().then(() => setActivePlanId(planId));
  }

  function handlePlanUpdated() {
    setShowEdit(false);
    if (activePlanId) loadPlan(activePlanId);
  }

  const actsByDate = new Map<string, ActivitySummary[]>();
  for (const a of activities) {
    const arr = actsByDate.get(a.date) ?? [];
    arr.push(a);
    actsByDate.set(a.date, arr);
  }

  return (
    <div className="h-full overflow-y-auto scroll-touch">
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">

        {/* Plan selector + edit */}
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <PlanSelector
              plans={plans}
              activePlanId={activePlanId}
              onSelect={id => { setActivePlanId(id); setView({ type: 'block' }); }}
              onNew={() => setShowCreate(true)}
              onDelete={handleDeletePlan}
            />
          </div>
          {plan && (
            <button
              onClick={() => setShowEdit(true)}
              className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
              title="Edit plan"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          )}
        </div>

        {/* Plan goal */}
        {plan && view.type === 'block' && (
          <p className="text-sm text-gray-400">
            <span className="font-medium text-white">{plan.name}</span>
            {plan.goal && <> · {plan.goal}</>}
          </p>
        )}

        {/* Loading skeleton */}
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
              onClick={() => setShowCreate(true)}
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
                onSelectDay={day => setView({ type: 'day', day })}
              />
            )}

            {view.type === 'day' && (
              <DayView
                day={view.day}
                activities={actsByDate.get(view.day.date) ?? []}
                onBack={() => setView({ type: 'block' })}
              />
            )}
          </>
        )}

      </div>

      {showCreate && (
        <CreatePlanModal
          onClose={() => setShowCreate(false)}
          onCreated={handlePlanCreated}
        />
      )}

      {showEdit && plan && (
        <EditPlanModal
          plan={plan}
          onClose={() => setShowEdit(false)}
          onUpdated={handlePlanUpdated}
        />
      )}
    </div>
  );
}
