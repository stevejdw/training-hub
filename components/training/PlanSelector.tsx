'use client';

interface PlanMeta {
  id: number;
  name: string;
  goal: string;
  created_at: string;
}

interface Props {
  plans: PlanMeta[];
  activePlanId: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
  onDelete: (id: number) => void;
}

export default function PlanSelector({ plans, activePlanId, onSelect, onNew, onDelete }: Props) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={activePlanId ?? ''}
        onChange={e => e.target.value && onSelect(Number(e.target.value))}
        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white flex-1 min-w-0"
      >
        <option value="" disabled>Select a plan…</option>
        {plans.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <button
        onClick={onNew}
        className="px-3 py-2 bg-orange-500 hover:bg-orange-400 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
      >
        + New plan
      </button>
      {activePlanId && (
        <button
          onClick={() => {
            if (confirm('Delete this plan?')) onDelete(activePlanId);
          }}
          className="px-3 py-2 bg-gray-800 hover:bg-red-900/50 text-gray-400 hover:text-red-400 rounded-lg text-sm transition-colors"
        >
          Delete
        </button>
      )}
    </div>
  );
}
