'use client';

import { useEffect, useState } from 'react';
import CreatePlanModal from './CreatePlanModal';
import EditPlanModal from './EditPlanModal';
import { TrainingPlan } from '@/lib/training-plans';

interface PlanMeta {
  id: number;
  name: string;
  goal: string;
  created_at: string;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
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
          {plans.map((plan, i) => (
            <div
              key={plan.id}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
                i === 0 ? 'border-orange-500/30 bg-orange-500/5' : 'border-gray-800 bg-gray-800/40'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white truncate">{plan.name}</p>
                  {i === 0 && (
                    <span className="flex-shrink-0 text-[10px] bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded px-1.5 py-0.5 font-medium">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {plan.goal && <span className="text-gray-400">{plan.goal} · </span>}
                  Created {fmtDate(plan.created_at)}
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
          ))}
        </div>
      )}

      <p className="text-xs text-gray-600">The most recently created plan is shown as Active on the Training tab.</p>

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
