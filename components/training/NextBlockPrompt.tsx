'use client';

import { useEffect, useState } from 'react';

interface Suggestion {
  focus: string;
  rationale: string;
  suggestedStartDate: string | null;
}

interface Props {
  planId: number;
  /** True once the plan's end date has passed (vs. simply being in the last week). */
  ended: boolean;
  onGenerate: (prefill: { goal: string; notes: string; startDate?: string }) => void;
}

/**
 * Shown on the Training Plan tab during the final week of (or after) a plan.
 * Pulls an AI focus suggestion for the next block based on the athlete's
 * performance over the block that's wrapping up, then lets them generate it
 * pre-filled in one tap.
 */
export default function NextBlockPrompt({ planId, ended, onGenerate }: Props) {
  const [sugg, setSugg]       = useState<Suggestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/training/plans/suggest-next?planId=${planId}`)
      .then(r => r.json())
      .then((data: Suggestion & { error?: string }) => {
        if (cancelled) return;
        if (data.error || !data.focus) { setFailed(true); return; }
        setSugg(data);
      })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [planId]);

  function handleGenerate() {
    onGenerate({
      goal: sugg?.focus ?? '',
      notes: sugg?.rationale ? `Coach suggestion: ${sugg.rationale}` : '',
      startDate: sugg?.suggestedStartDate ?? undefined,
    });
  }

  return (
    <div className="rounded-2xl border border-orange-500/30 bg-gradient-to-br from-orange-500/10 to-orange-500/[0.02] p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-lg">🏁</span>
        <h3 className="text-sm font-semibold text-white">
          {ended ? 'This plan has finished' : "You're in the final week"}
        </h3>
      </div>
      <p className="text-xs text-gray-400 leading-relaxed">
        Time to plan your next block. Here&apos;s what your coach suggests based on how this block went:
      </p>

      {loading && (
        <div className="space-y-2">
          <div className="h-4 w-1/2 bg-gray-800 rounded animate-pulse" />
          <div className="h-3 w-full bg-gray-800 rounded animate-pulse" />
          <div className="h-3 w-4/5 bg-gray-800 rounded animate-pulse" />
        </div>
      )}

      {!loading && sugg && (
        <div className="rounded-xl bg-gray-900/60 border border-gray-800 p-3 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-orange-400 font-semibold">Suggested focus</span>
          </div>
          <p className="text-sm font-medium text-white">{sugg.focus}</p>
          <p className="text-xs text-gray-400 leading-relaxed">{sugg.rationale}</p>
        </div>
      )}

      {!loading && failed && (
        <p className="text-xs text-gray-500">Couldn&apos;t load a suggestion right now — you can still create a plan from scratch.</p>
      )}

      <button
        onClick={handleGenerate}
        className="w-full py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-white text-sm font-medium transition-colors"
      >
        + Generate next block
      </button>
    </div>
  );
}
