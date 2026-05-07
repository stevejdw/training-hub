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
 * Decay factor for an N-day time-constant exponential moving average.
 * intervals.icu uses α = 1 - e^(-1/N), which is the correct continuous-time
 * formulation for an EWMA with a time constant of N days. The common
 * "2/(N+1)" approximation would respond ~2× faster and give different results.
 */
function emaDecay(N: number): number {
  return 1 - Math.exp(-1 / N);
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
 * Run the EWMA for CTL and ATL over a filled daily TSS array.
 * Shared core used by both calculateFitness and calculateFitnessHistory.
 */
function runEma(
  filled: DailyTSS[],
  ctlSeed: number,
  atlSeed: number,
): { dates: string[]; ctls: number[]; atls: number[] } {
  const ctlDecay = emaDecay(42);
  const atlDecay = emaDecay(7);

  let ctl = ctlSeed;
  let atl = atlSeed;

  const dates: string[] = [];
  const ctls: number[]  = [];
  const atls: number[]  = [];

  for (const { date, tss } of filled) {
    ctl = tss * ctlDecay + ctl * (1 - ctlDecay);
    atl = tss * atlDecay + atl * (1 - atlDecay);
    dates.push(date);
    ctls.push(Math.round(ctl * 10) / 10);
    atls.push(Math.round(atl * 10) / 10);
  }

  return { dates, ctls, atls };
}

/**
 * Calculate CTL/ATL/TSB from an array of daily TSS values.
 * Returns the current (most recent day) values.
 */
export function calculateFitness(dailyTss: DailyTSS[]): FitnessMetrics {
  if (dailyTss.length === 0) return { ctl: 0, atl: 0, tsb: 0 };

  // Sort ascending by date
  const sorted = [...dailyTss].sort((a, b) => a.date.localeCompare(b.date));

  // Fill date gaps with 0 TSS so the EMA decays properly on rest days
  const filled = fillGaps(sorted);

  // Seed CTL/ATL with the average TSS over the respective windows so the
  // EMA doesn't start from an unrealistic 0 during the cold-start phase.
  const ctlSeed = computeSeed(filled, 42);
  const atlSeed = computeSeed(filled, 7);

  const { ctls, atls } = runEma(filled, ctlSeed, atlSeed);

  const ctl = ctls[ctls.length - 1] ?? 0;
  const atl = atls[atls.length - 1] ?? 0;

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

  // Seed CTL/ATL with the average TSS over the respective windows
  const ctlSeed = computeSeed(filled, 42);
  const atlSeed = computeSeed(filled, 7);

  const { dates, ctls, atls } = runEma(filled, ctlSeed, atlSeed);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const result: Array<{ date: string; ctl: number; atl: number; tsb: number }> = [];

  for (let i = 0; i < dates.length; i++) {
    if (dates[i] >= cutoffStr) {
      result.push({
        date: dates[i],
        ctl:  ctls[i],
        atl:  atls[i],
        tsb:  Math.round((ctls[i] - atls[i]) * 10) / 10,
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
