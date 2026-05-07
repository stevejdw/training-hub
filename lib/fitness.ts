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
 * Run the CTL/ATL EWMA over a daily TSS array using intervals.icu's formulas:
 *
 *   CTL_today = CTL_yesterday × e^(-1/42) + TSS_today × (1 - e^(-1/42))
 *   ATL_today = ATL_yesterday × e^(-1/7)  + TSS_today × (1 - e^(-1/7))
 *
 *   TSB_today = CTL_yesterday − ATL_yesterday
 *
 * Both CTL and ATL start at 0 and are updated sequentially.
 */
function computeEma(
  dailyTss: DailyTSS[],
): { dates: string[]; ctls: number[]; atls: number[]; tsbs: number[] } {
  const ctlDecay = 1 - Math.exp(-1 / 42);  // ≈ 0.0235
  const atlDecay = 1 - Math.exp(-1 / 7);   // ≈ 0.133

  let ctl = 0;
  let atl = 0;

  // For the very first day, there is no "yesterday", so TSB = 0
  let prevCtl = 0;
  let prevAtl = 0;

  const dates: string[] = [];
  const ctls: number[]  = [];
  const atls: number[]  = [];
  const tsbs: number[]  = [];

  for (const { date, tss } of dailyTss) {
    // TSB for today is yesterday's CTL minus yesterday's ATL
    const tsb = Math.round((prevCtl - prevAtl) * 10) / 10;

    // Update CTL/ATL with today's TSS (intervals.icu formula)
    ctl = ctl * Math.exp(-1 / 42) + tss * (1 - Math.exp(-1 / 42));
    atl = atl * Math.exp(-1 / 7)  + tss * (1 - Math.exp(-1 / 7));

    dates.push(date);
    ctls.push(Math.round(ctl * 10) / 10);
    atls.push(Math.round(atl * 10) / 10);
    tsbs.push(tsb);

    prevCtl = ctl;
    prevAtl = atl;
  }

  return { dates, ctls, atls, tsbs };
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
  const { ctls, atls, tsbs } = computeEma(timeline);

  const ctl = ctls[ctls.length - 1] ?? 0;
  const atl = atls[atls.length - 1] ?? 0;
  const tsb = tsbs[tsbs.length - 1] ?? 0;

  return {
    ctl: Math.round(ctl * 10) / 10,
    atl: Math.round(atl * 10) / 10,
    tsb: Math.round(tsb * 10) / 10,
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
  const { dates, ctls, atls, tsbs } = computeEma(timeline);

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
        tsb:  tsbs[i],
      });
    }
  }
  return result;
}
