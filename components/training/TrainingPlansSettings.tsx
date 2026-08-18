'use client';

import { useEffect, useState } from 'react';
import CreatePlanModal from './CreatePlanModal';
import EditPlanModal from './EditPlanModal';
import { TrainingPlan } from '@/lib/training-plans';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

interface PlanMeta {
  id: number;
  name: string;
  goal: string;
  created_at: string;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

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

  /* window.confirm sat oddly beside EditPlanModal's own in-app confirm step —
     two confirmation patterns for the same destructive action. */
  const [pendingDelete, setPendingDelete] = useState<{ id: number; name: string } | null>(null);

  async function handleDelete(planId: number) {
    setPendingDelete(null);
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

  return (
    <div className="bg-surface rounded-xl p-5 space-y-4 border border-line">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-2 uppercase tracking-wider">Training Plans</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="px-3 py-1.5 text-sm font-medium bg-accent hover:bg-accent-hi text-ink rounded-lg transition-colors"
        >
          + Generate plan
        </button>
      </div>

      {loading && (
        <div className="space-y-2">
          {[1, 2].map(i => <div key={i} className="h-16 bg-raised rounded-xl animate-pulse" />)}
        </div>
      )}

      {!loading && plans.length === 0 && (
        <div className="rounded-xl border border-line-strong border-dashed p-6 text-center">
          <p className="text-sm text-ink-4">No training plans yet</p>
          <p className="text-xs text-ink-5 mt-1">Generate an AI-personalised plan based on your profile and goals</p>
        </div>
      )}

      {plans.length > 0 && (
        <div className="space-y-2">
          {plans.map((plan, i) => (
            <div
              key={plan.id}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
                i === 0 ? 'border-accent/30 bg-accent/5' : 'border-line bg-raised/40'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-ink truncate">{plan.name}</p>
                  {i === 0 && (
                    <span className="flex-shrink-0 text-micro bg-accent/20 text-accent-hi border border-accent/30 rounded px-1.5 py-0.5 font-medium">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-ink-4 mt-0.5">
                  {plan.goal && <span className="text-ink-3">{plan.goal} · </span>}
                  Created {fmtDate(plan.created_at)}
                </p>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => handleEdit(plan.id)}
                  disabled={loadingEdit === plan.id}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-raised hover:bg-hover text-ink-2 hover:text-ink transition-colors disabled:opacity-50"
                >
                  {loadingEdit === plan.id ? '…' : 'Edit'}
                </button>
                <button
                  onClick={() => setPendingDelete({ id: plan.id, name: plan.name })}
                  disabled={deleting === plan.id}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-raised hover:bg-red-900/50 text-ink-4 hover:text-red-400 transition-colors disabled:opacity-50"
                >
                  {deleting === plan.id ? '…' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-ink-5">The most recently created plan is shown as Active on the Training tab.</p>

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

    <ConfirmDialog
      open={pendingDelete !== null}
      title="Delete training plan"
      message={`Delete "${pendingDelete?.name ?? ''}"? This cannot be undone.`}
      confirmLabel="Delete"
      onConfirm={() => pendingDelete && handleDelete(pendingDelete.id)}
      onCancel={() => setPendingDelete(null)}
    />
    </div>
  );
}
