'use client';

import { useCallback, useEffect, useState } from 'react';
import { TrainingPlan, TrainingDay } from '@/lib/training-plans';
import BlockView from '@/components/training/BlockView';
import DayView from '@/components/training/DayView';
import EditPlanModal from '@/components/training/EditPlanModal';
import CreatePlanModal from '@/components/training/CreatePlanModal';
import NextBlockPrompt from '@/components/training/NextBlockPrompt';
import ErrorBoundary from '@/components/training/ErrorBoundary';
import { isInFinalWeek } from '@/lib/plan-status';
import { todayInTimezone } from '@/lib/timezone';

interface PlanMeta { id: number; name: string; goal: string; created_at: string; start_date: string | null; end_date: string | null }

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
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [today, setToday]               = useState<string>(() => todayInTimezone('Australia/Sydney'));
  const [plans, setPlans]               = useState<PlanMeta[]>([]);
  const [nextBlockPrefill, setNextBlockPrefill] = useState<{ goal: string; notes: string; startDate?: string } | null>(null);

  const fetchActivePlan = useCallback(() => {
    setLoadingPlan(true);
    return fetch('/api/training/plans/active')
      .then(r => r.json())
      .then((data: { plans: PlanMeta[]; plan: TrainingPlan | null; activities: ActivitySummary[]; today?: string }) => {
        if (data.plan) { setPlan(data.plan); setActivePlanId(data.plan.id); }
        else           { setPlan(null);      setActivePlanId(null); }
        if (data.activities) setActivities(data.activities);
        if (data.plans) setPlans(data.plans);
        if (data.today) setToday(data.today);
      })
      .catch(console.error)
      .finally(() => setLoadingPlan(false));
  }, []);

  useEffect(() => { fetchActivePlan(); }, [fetchActivePlan]);

  const loadPlan = useCallback((id: number, { silent = false } = {}) => {
    if (!silent) setLoadingPlan(true);
    fetch(`/api/training/plans/${id}`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json() as Promise<TrainingPlan>; })
      .then(data => {
        if (!data?.days) { setPlan(null); setActivePlanId(null); return; }
        setPlan(data);
        setView({ type: 'block' });
        if (data.days?.length) {
          fetch(`/api/training/activities?from=${data.days[0].date}&to=${data.days[data.days.length - 1].date}`)
            .then(r => r.json()).then(acts => { if (Array.isArray(acts)) setActivities(acts); }).catch(console.error);
        }
      })
      .catch(console.error)
      .finally(() => { if (!silent) setLoadingPlan(false); });
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

      {/* No plan — empty state with Add plan CTA */}
      {!loadingPlan && !plan && (
        <div className="bg-gray-800/40 border border-gray-700 border-dashed rounded-2xl p-8 text-center space-y-4">
          <div>
            <p className="text-sm text-gray-300 font-medium">No active training plan</p>
            <p className="text-xs text-gray-500 mt-1">Generate an AI-personalised plan based on your profile and goals.</p>
          </div>
          <button
            onClick={() => setCreatingPlan(true)}
            className="px-4 py-2.5 text-sm font-medium bg-orange-500 hover:bg-orange-400 text-white rounded-lg transition-colors"
          >
            + Add plan
          </button>
        </div>
      )}

      {loadingPlan && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => <div key={i} className="bg-gray-800 rounded-xl h-32 animate-pulse" />)}
        </div>
      )}

      {/* Final-week prompt: suggest building the next block */}
      {!loadingPlan && plan && view.type === 'block' && plan.days.length > 0 && (() => {
        const planSummary = {
          id: plan.id, name: plan.name, goal: plan.goal, created_at: plan.created_at,
          start_date: plan.days[0].date,
          end_date: plan.days[plan.days.length - 1].date,
        };
        if (!isInFinalWeek(planSummary, today)) return null;
        // Don't nag if a successor block is already scheduled to start later.
        const hasSuccessor = plans.some(
          p => p.id !== plan.id && p.start_date && p.start_date > planSummary.end_date!,
        );
        if (hasSuccessor) return null;
        return (
          <NextBlockPrompt
            planId={plan.id}
            ended={today > planSummary.end_date!}
            onGenerate={prefill => setNextBlockPrefill(prefill)}
          />
        );
      })()}

      {!loadingPlan && plan && (
        <>
          {view.type === 'block' && (
            <ErrorBoundary>
              <BlockView
                days={plan.days}
                activities={activities}
                onSelectDay={day => setView({ type: 'day', day })}
                onDaysChanged={() => { if (activePlanId) loadPlan(activePlanId, { silent: true }); }}
              />
            </ErrorBoundary>
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
          onUpdated={() => { setEditingPlan(false); fetchActivePlan(); }}
        />
      )}

      {creatingPlan && (
        <CreatePlanModal
          onClose={() => setCreatingPlan(false)}
          onCreated={() => { setCreatingPlan(false); fetchActivePlan(); }}
        />
      )}

      {nextBlockPrefill && (
        <CreatePlanModal
          initialGoal={nextBlockPrefill.goal}
          initialNotes={nextBlockPrefill.notes}
          initialStartDate={nextBlockPrefill.startDate}
          onClose={() => setNextBlockPrefill(null)}
          onCreated={() => { setNextBlockPrefill(null); fetchActivePlan(); }}
        />
      )}
    </div>
  );
}
