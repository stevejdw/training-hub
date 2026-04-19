'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
// useCallback kept for loadPlan
import { TrainingPlan, TrainingDay } from '@/lib/training-plans';
import BlockView from './training/BlockView';
import DayView from './training/DayView';
import SummaryTab from './training/SummaryTab';
import EditPlanModal from './training/EditPlanModal';
import DashboardBestPower from './DashboardBestPower';

type MainTab = 'summary' | 'best-efforts' | 'plan';
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
  { key: 'summary',      label: 'Summary'       },
  { key: 'best-efforts', label: 'Best Efforts'  },
  { key: 'plan',         label: 'Training Plan' },
];

export default function TrainingPlanner() {
  const searchParams = useSearchParams();
  const rawTab = searchParams.get('tab');
  const initialTab: MainTab = (rawTab === 'summary' || rawTab === 'best-efforts' || rawTab === 'plan') ? rawTab : 'summary';
  const [mainTab, setMainTab]           = useState<MainTab>(initialTab);
  const [activePlanId, setActivePlanId] = useState<number | null>(null);
  const [plan, setPlan]                 = useState<TrainingPlan | null>(null);
  const [activities, setActivities]     = useState<ActivitySummary[]>([]);
  const [view, setView]                 = useState<View>({ type: 'block' });
  const [loadingPlan, setLoadingPlan]   = useState(false);
  const [editingPlan, setEditingPlan]   = useState(false);

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

          {/* Best Efforts tab */}
          {mainTab === 'best-efforts' && <DashboardBestPower />}

          {/* Training Plan tab */}
          {mainTab === 'plan' && (
            <div className="space-y-4">
              {/* Plan name/goal header */}
              {plan && view.type === 'block' && (() => {
                // Parse "12 Week Plan: Event name" into parts
                const m = plan.name.match(/^(\d+)\s*[Ww]eeks?\s*[Pp]lan\s*[:\-–]\s*(.+)$/);
                const weekBadge = m ? `${m[1]} Weeks` : null;
                const title     = m ? m[2].trim() : plan.name;
                return (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {weekBadge && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-orange-500/15 text-orange-400 text-[11px] font-semibold uppercase tracking-wider mb-1.5">
                          {weekBadge}
                        </span>
                      )}
                      <h2 className="text-xl font-bold text-white leading-tight">{title}</h2>
                      {plan.goal && (
                        <p className="text-sm text-gray-400 mt-1 leading-snug">{plan.goal}</p>
                      )}
                    </div>
                    <button
                      onClick={() => setEditingPlan(true)}
                      className="flex-shrink-0 mt-0.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                    >
                      Edit
                    </button>
                  </div>
                );
              })()}

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

      {/* Edit plan modal */}
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
