export interface DailyTSS {
  date: string; // YYYY-MM-DD
  tss: number;
}

export interface FitnessMetrics {
  ctl: number;  // Chronic Training Load (42-day EMA)
  atl: number;  // Acute Training Load (7-day EMA)
  tsb: number;  // Training Stress Balance = CTL - ATL
}

/**
 * Compute an initial seed for the EMA by averaging TSS over the first N
 * *calendar* days (including zeros). This matches intervals.icu's approach:
 * it uses the first 42 days to seed CTL and the first 7 days to seed ATL,
 * which eliminates the cold-start ramp-up that starting from 0 would cause.
 */
function computeSeed(dailyTss: DailyTSS[], days: number): number {
  const slice = dailyTss.slice(0, Math.min(days, dailyTss.length));
  if (slice.length === 0) return 0;
  return slice.reduce((s, d) => s + d.tss, 0) / slice.length;
}

/**
 * Calculate CTL/ATL/TSB from an array of daily TSS values.
 * Returns the current (most recent day) values.
 */
export function calculateFitness(dailyTss: DailyTSS[]): FitnessMetrics {
  if (dailyTss.length === 0) return { ctl: 0, atl: 0, tsb: 0 };

  // Sort ascending by date
  const sorted = [...dailyTss].sort((a, b) => a.date.localeCompare(b.date));

  // Fill date gaps with 0 TSS
  const filled = fillGaps(sorted);

  // EMA decay factors
  const ctlDecay = 2 / (42 + 1);
  const atlDecay = 2 / (7 + 1);

  // Seed CTL/ATL with the average TSS over the respective windows so the
  // EMA doesn't start from an unrealistic 0 during the cold-start phase.
  let ctl = computeSeed(filled, 42);
  let atl = computeSeed(filled, 7);

  for (const { tss } of filled) {
    ctl = tss * ctlDecay + ctl * (1 - ctlDecay);
    atl = tss * atlDecay + atl * (1 - atlDecay);
  }

  return {
    ctl: Math.round(ctl * 10) / 10,
    atl: Math.round(atl * 10) / 10,
    tsb: Math.round((ctl - atl) * 10) / 10,
  };
}

/**
 * Calculate full CTL/ATL/TSB history for charting.
 * Returns one entry per day from startDate to today.
 */
export function calculateFitnessHistory(
  dailyTss: DailyTSS[],
  daysBack = 180
): Array<{ date: string; ctl: number; atl: number; tsb: number }> {
  const sorted = [...dailyTss].sort((a, b) => a.date.localeCompare(b.date));
  const filled = fillGaps(sorted);

  const ctlDecay = 2 / (42 + 1);
  const atlDecay = 2 / (7 + 1);

  // Seed CTL/ATL with the average TSS over the respective windows
  let ctl = computeSeed(filled, 42);
  let atl = computeSeed(filled, 7);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const result: Array<{ date: string; ctl: number; atl: number; tsb: number }> = [];

  for (const { date, tss } of filled) {
    ctl = tss * ctlDecay + ctl * (1 - ctlDecay);
    atl = tss * atlDecay + atl * (1 - atlDecay);
    if (date >= cutoffStr) {
      result.push({
        date,
        ctl: Math.round(ctl * 10) / 10,
        atl: Math.round(atl * 10) / 10,
        tsb: Math.round((ctl - atl) * 10) / 10,
      });
    }
  }

  return result;
}

function fillGaps(sorted: DailyTSS[]): DailyTSS[] {
  if (sorted.length === 0) return [];
  const result: DailyTSS[] = [];
  const current = new Date(sorted[0].date);
  const end = new Date(); // today

  let i = 0;
  while (current <= end) {
    const dateStr = current.toISOString().slice(0, 10);
    if (i < sorted.length && sorted[i].date === dateStr) {
      result.push(sorted[i]);
      i++;
    } else {
      result.push({ date: dateStr, tss: 0 });
    }
    current.setDate(current.getDate() + 1);
  }
  return result;
}
