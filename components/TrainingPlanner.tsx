'use client';

import { useEffect, useState, useCallback } from 'react';
// useCallback kept for loadPlan
import { TrainingPlan, TrainingDay } from '@/lib/training-plans';
import BlockView from './training/BlockView';
import DayView from './training/DayView';
import SummaryTab from './training/SummaryTab';
import ObjectivesTab from './training/ObjectivesTab';
import FitnessTab from './training/FitnessTab';

type MainTab = 'summary' | 'objectives' | 'fitness' | 'plan';
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

const TABS: { key: MainTab; label: string }[] = [
  { key: 'summary',    label: 'Summary'       },
  { key: 'objectives', label: 'Objectives'    },
  { key: 'fitness',    label: 'Fitness'       },
  { key: 'plan',       label: 'Training Plan' },
];

export default function TrainingPlanner() {
  const [mainTab, setMainTab]           = useState<MainTab>('summary');
  const [activePlanId, setActivePlanId] = useState<number | null>(null);
  const [plan, setPlan]                 = useState<TrainingPlan | null>(null);
  const [activities, setActivities]     = useState<ActivitySummary[]>([]);
  const [view, setView]                 = useState<View>({ type: 'block' });
  const [loadingPlan, setLoadingPlan]   = useState(false);

  // Initial load: plans + active plan + activities (only needed for plan tab)
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const actsByDate = new Map<string, ActivitySummary[]>();
  for (const a of activities) {
    const arr = actsByDate.get(a.date) ?? [];
    arr.push(a);
    actsByDate.set(a.date, arr);
  }

  return (
    <div className="h-full flex flex-col">

      {/* Tab bar — fixed, never scrolls */}
      <div className="flex-shrink-0 flex border-b border-gray-800 overflow-x-auto">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setMainTab(key)}
            className={`px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors -mb-px ${
              mainTab === key
                ? 'border-orange-500 text-white'
                : 'border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto scroll-touch">
        <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">

          {/* Summary tab */}
          {mainTab === 'summary' && <SummaryTab />}

          {/* Objectives tab */}
          {mainTab === 'objectives' && <ObjectivesTab />}

          {/* Fitness tab */}
          {mainTab === 'fitness' && <FitnessTab />}

          {/* Training Plan tab */}
          {mainTab === 'plan' && (
            <div className="space-y-4">
              {/* Plan name/goal header */}
              {plan && view.type === 'block' && (
                <div>
                  <h2 className="text-lg font-semibold text-white">{plan.name}</h2>
                  {plan.goal && <p className="text-sm text-gray-400 mt-0.5">{plan.goal}</p>}
                </div>
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
              {!loadingPlan && !plan && (
                <div className="bg-gray-800/40 border border-gray-700 border-dashed rounded-2xl p-10 text-center space-y-3">
                  <div className="text-4xl">📅</div>
                  <h3 className="text-lg font-semibold text-white">No training plan</h3>
                  <p className="text-sm text-gray-400">Generate a plan from the Settings page</p>
                  <a
                    href="/profile"
                    className="inline-block mt-2 px-5 py-2.5 bg-orange-500 hover:bg-orange-400 text-white rounded-xl text-sm font-medium transition-colors"
                  >
                    Go to Settings
                  </a>
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
                      onDayUpdated={() => { if (activePlanId) loadPlan(activePlanId); }}
                    />
                  )}
                </>
              )}
            </div>
          )}

        </div>
      </div>

    </div>
  );
}
