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

const TABS: { key: MainTab; label: string; icon: React.ReactNode }[] = [
  {
    key: 'summary', label: 'Summary',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    key: 'best-efforts', label: 'Best Efforts',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.539 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118L2.072 10.1c-.783-.57-.38-1.81.588-1.81h4.915a1 1 0 00.95-.69l1.519-4.673z" />
      </svg>
    ),
  },
  {
    key: 'plan', label: 'Training Plan',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
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
    <div className="h-full flex flex-col md:flex-row">

      {/* Mobile tab bar */}
      <div className="md:hidden flex-shrink-0 flex border-b border-gray-800 overflow-x-auto">
        {TABS.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setMainTab(key)}
            className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors -mb-px ${
              mainTab === key
                ? 'border-orange-500 text-white'
                : 'border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-600'
            }`}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col flex-shrink-0 w-56 border-r border-gray-800 bg-gray-950/50 py-6 px-3 gap-1">
        <div className="px-3 pb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          Training
        </div>
        {TABS.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setMainTab(key)}
            className={`flex items-center gap-2.5 text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              mainTab === key
                ? 'bg-orange-500/15 text-orange-400 border-l-2 border-orange-500 pl-[10px]'
                : 'text-gray-400 hover:text-white hover:bg-gray-800/60'
            }`}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </aside>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto scroll-touch min-w-0">
        <div className="max-w-2xl md:max-w-5xl mx-auto px-4 py-4 md:px-8 md:py-8 space-y-4">

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
