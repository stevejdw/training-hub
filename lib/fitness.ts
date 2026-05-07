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
 * Run the CTL/ATL EWMA over a daily TSS array using Coggan's formula:
 *
 *   CTL_t = CTL_{t-1} + α_ctl × (TSS_t − CTL_{t-1})
 *   ATL_t = ATL_{t-1} + α_atl × (TSS_t − ATL_{t-1})
 *
 * where α = 2 / (N + 1).  This matches intervals.icu, TrainingPeaks, etc.
 */
function computeEma(
  dailyTss: DailyTSS[],
): { dates: string[]; ctls: number[]; atls: number[] } {
  const ctlDecay = 2 / (42 + 1);   // ≈ 0.0465
  const atlDecay = 2 / (7 + 1);    // ≈ 0.25

  // Matches intervals.icu: both start at 0
  let ctl = 0;
  let atl = 0;

  const dates: string[] = [];
  const ctls: number[]  = [];
  const atls: number[]  = [];

  for (const { date, tss } of dailyTss) {
    ctl += ctlDecay * (tss - ctl);
    atl += atlDecay * (tss - atl);
    dates.push(date);
    ctls.push(Math.round(ctl * 10) / 10);
    atls.push(Math.round(atl * 10) / 10);
  }

  return { dates, ctls, atls };
}

/**
 * Build a complete daily TSS timeline from the earliest data point to today.
 * Any missing days get TSS = 0, which means the EMA naturally decays on rest
 * days — exactly how intervals.icu works.
 */
function buildFullTimeline(sorted: DailyTSS[]): DailyTSS[] {
  if (sorted.length === 0) return [];
  const result: DailyTSS[] = [];
  const cursor = new Date(sorted[0].date);
  const end    = new Date();
  let i = 0;

  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    if (i < sorted.length && sorted[i].date === key) {
      result.push(sorted[i]);
      i++;
    } else {
      result.push({ date: key, tss: 0 });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

/**
 * Calculate current CTL/ATL/TSB from an array of daily TSS values.
 */
export function calculateFitness(dailyTss: DailyTSS[]): FitnessMetrics {
  if (dailyTss.length === 0) return { ctl: 0, atl: 0, tsb: 0 };

  const sorted = [...dailyTss].sort((a, b) => a.date.localeCompare(b.date));
  const timeline = buildFullTimeline(sorted);
  const { ctls, atls } = computeEma(timeline);

  const ctl = ctls[ctls.length - 1] ?? 0;
  const atl = atls[atls.length - 1] ?? 0;

  return {
    ctl: Math.round(ctl * 10) / 10,
    atl: Math.round(atl * 10) / 10,
    tsb: Math.round((ctl - atl) * 10) / 10,
  };
}

/**
 * Calculate CTL/ATL/TSB history for charting.
 * Returns one entry per day from daysBack days ago to today.
 */
export function calculateFitnessHistory(
  dailyTss: DailyTSS[],
  daysBack = 180,
): Array<{ date: string; ctl: number; atl: number; tsb: number }> {
  const sorted = [...dailyTss].sort((a, b) => a.date.localeCompare(b.date));
  const timeline = buildFullTimeline(sorted);
  const { dates, ctls, atls } = computeEma(timeline);

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
