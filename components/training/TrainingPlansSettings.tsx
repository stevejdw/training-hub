'use client';

import { useEffect, useState } from 'react';
import CreatePlanModal from './CreatePlanModal';
import EditPlanModal from './EditPlanModal';
import { TrainingPlan } from '@/lib/training-plans';
import { PlanSummary, PlanStatus, planStatus, pickActivePlan } from '@/lib/plan-status';
import { todayInTimezone } from '@/lib/timezone';

type PlanMeta = PlanSummary;

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtRange(start: string | null, end: string | null) {
  if (!start || !end) return null;
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  const s = new Date(start + 'T00:00:00Z').toLocaleDateString('en-AU', { ...opts, timeZone: 'UTC' });
  const e = new Date(end + 'T00:00:00Z').toLocaleDateString('en-AU', { ...opts, year: 'numeric', timeZone: 'UTC' });
  return `${s} – ${e}`;
}

const STATUS_BADGE: Record<PlanStatus, { label: string; cls: string } | null> = {
  active:    { label: 'Active',    cls: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  upcoming:  { label: 'Upcoming',  cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  completed: { label: 'Completed', cls: 'bg-gray-700/40 text-gray-400 border-gray-600/40' },
  empty:     null,
};

export default function TrainingPlansSettings() {
  const [plans, setPlans]         = useState<PlanMeta[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editPlan, setEditPlan]   = useState<TrainingPlan | null>(null);
  const [loadingEdit, setLoadingEdit] = useState<number | null>(null);
  const [deleting, setDeleting]   = useState<number | null>(null);

  function fetchPlans() {
    return fetch('/api/training/plans')
      .then(r => r.json())
      .then((data: PlanMeta[]) => { setPlans(data); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => { fetchPlans(); }, []);

  async function handleEdit(planId: number) {
    setLoadingEdit(planId);
    try {
      const res = await fetch(`/api/training/plans/${planId}`);
      const plan: TrainingPlan = await res.json();
      setEditPlan(plan);
    } finally {
      setLoadingEdit(null);
    }
  }

  async function handleDelete(planId: number, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setDeleting(planId);
    await fetch(`/api/training/plans/${planId}`, { method: 'DELETE' });
    setDeleting(null);
    fetchPlans();
  }

  function handleCreated() {
    setShowCreate(false);
    fetchPlans();
  }

  function handleUpdated() {
    setEditPlan(null);
    fetchPlans();
  }

  const today = todayInTimezone('Australia/Sydney');
  const activeId = pickActivePlan(plans, today)?.id ?? null;

  return (
    <div className="bg-gray-900 rounded-xl p-5 space-y-4 border border-gray-800">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Training Plans</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="px-3 py-1.5 text-sm font-medium bg-orange-500 hover:bg-orange-400 text-white rounded-lg transition-colors"
        >
          + Generate plan
        </button>
      </div>

      {loading && (
        <div className="space-y-2">
          {[1, 2].map(i => <div key={i} className="h-16 bg-gray-800 rounded-xl animate-pulse" />)}
        </div>
      )}

      {!loading && plans.length === 0 && (
        <div className="rounded-xl border border-gray-700 border-dashed p-6 text-center">
          <p className="text-sm text-gray-500">No training plans yet</p>
          <p className="text-xs text-gray-600 mt-1">Generate an AI-personalised plan based on your profile and goals</p>
        </div>
      )}

      {plans.length > 0 && (
        <div className="space-y-2">
          {plans.map((plan) => {
            const isActive = plan.id === activeId;
            const status = planStatus(plan, today);
            const badge = isActive ? STATUS_BADGE.active : STATUS_BADGE[status];
            const range = fmtRange(plan.start_date, plan.end_date);
            return (
            <div
              key={plan.id}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
                isActive ? 'border-orange-500/30 bg-orange-500/5' : 'border-gray-800 bg-gray-800/40'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white truncate">{plan.name}</p>
                  {badge && (
                    <span className={`flex-shrink-0 text-[10px] border rounded px-1.5 py-0.5 font-medium ${badge.cls}`}>
                      {badge.label}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {plan.goal && <span className="text-gray-400">{plan.goal} · </span>}
                  {range ?? `Created ${fmtDate(plan.created_at)}`}
                </p>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => handleEdit(plan.id)}
                  disabled={loadingEdit === plan.id}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors disabled:opacity-50"
                >
                  {loadingEdit === plan.id ? '…' : 'Edit'}
                </button>
                <button
                  onClick={() => handleDelete(plan.id, plan.name)}
                  disabled={deleting === plan.id}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-800 hover:bg-red-900/50 text-gray-500 hover:text-red-400 transition-colors disabled:opacity-50"
                >
                  {deleting === plan.id ? '…' : 'Delete'}
                </button>
              </div>
            </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-gray-600">Plans activate automatically by date: the block covering today is shown as Active on the Training tab, and a plan scheduled to start later stays Upcoming until its dates arrive.</p>

      {showCreate && (
        <CreatePlanModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}

      {editPlan && (
        <EditPlanModal
          plan={editPlan}
          onClose={() => setEditPlan(null)}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  );
}
