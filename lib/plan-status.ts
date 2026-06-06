/**
 * Pure, client-safe helpers for reasoning about training-plan scheduling.
 *
 * IMPORTANT: This file must NOT import from lib/db.ts (or anything that does)
 * because it is consumed by client components as well as API routes.
 *
 * Dates are ISO YYYY-MM-DD strings, so plain string comparison is also
 * chronological comparison.
 */

export type PlanStatus = 'active' | 'upcoming' | 'completed' | 'empty';

export interface PlanSummary {
  id: number;
  name: string;
  goal: string;
  created_at: string;
  start_date: string | null; // earliest training day (YYYY-MM-DD) or null if no days
  end_date: string | null;   // latest training day (YYYY-MM-DD) or null if no days
}

/** Classify a single plan relative to `today` (YYYY-MM-DD). */
export function planStatus(plan: PlanSummary, today: string): PlanStatus {
  if (!plan.start_date || !plan.end_date) return 'empty';
  if (today < plan.start_date) return 'upcoming';
  if (today > plan.end_date) return 'completed';
  return 'active';
}

/**
 * Choose the plan that should be treated as "active" today, using the plans'
 * actual date ranges rather than simply the most recently created one.
 *
 * Precedence:
 *   1. A plan whose date range contains today. If several overlap, the one
 *      that started most recently wins (the block you've most recently begun).
 *   2. Otherwise the next upcoming plan (soonest start in the future) — e.g.
 *      a second plan scheduled to begin once the current one finishes.
 *   3. Otherwise the most recently finished plan (latest end date).
 *   4. Otherwise (no plan has any days) the most recently created plan.
 */
export function pickActivePlan<T extends PlanSummary>(plans: T[], today: string): T | null {
  if (plans.length === 0) return null;

  const current = plans
    .filter(p => p.start_date && p.end_date && today >= p.start_date && today <= p.end_date)
    .sort((a, b) => (b.start_date! < a.start_date! ? -1 : b.start_date! > a.start_date! ? 1 : b.id - a.id));
  if (current.length) return current[0];

  const upcoming = plans
    .filter(p => p.start_date && p.start_date > today)
    .sort((a, b) => (a.start_date! < b.start_date! ? -1 : a.start_date! > b.start_date! ? 1 : a.id - b.id));
  if (upcoming.length) return upcoming[0];

  const completed = plans
    .filter(p => p.end_date)
    .sort((a, b) => (a.end_date! < b.end_date! ? 1 : a.end_date! > b.end_date! ? -1 : b.id - a.id));
  if (completed.length) return completed[0];

  return plans[0];
}

/**
 * True when `today` falls within the final 7 days of the plan (inclusive),
 * or the plan has already ended. Used to prompt building the next block.
 */
export function isInFinalWeek(plan: PlanSummary, today: string): boolean {
  if (!plan.end_date) return false;
  if (today > plan.end_date) return true;
  const end = new Date(plan.end_date + 'T00:00:00Z');
  const finalWeekStart = new Date(end);
  finalWeekStart.setUTCDate(finalWeekStart.getUTCDate() - 6);
  const start = finalWeekStart.toISOString().slice(0, 10);
  return today >= start && today <= plan.end_date;
}
