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
 * Both CTL and ATL start at 0 and are updated sequentially.
 *
 * TSB is the current day's CTL − current day's ATL (matching intervals.icu
 * dashboard behaviour).
 */
function computeEma(
  dailyTss: DailyTSS[],
): { dates: string[]; ctls: number[]; atls: number[]; tsbs: number[] } {
  let ctl = 0;
  let atl = 0;

  const dates: string[] = [];
  const ctls: number[]  = [];
  const atls: number[]  = [];
  const tsbs: number[]  = [];

  for (const { date, tss } of dailyTss) {
    // Update CTL/ATL with today's TSS (intervals.icu formula)
    ctl = ctl * Math.exp(-1 / 42) + tss * (1 - Math.exp(-1 / 42));
    atl = atl * Math.exp(-1 / 7)  + tss * (1 - Math.exp(-1 / 7));

    // TSB = current CTL − current ATL (matches intervals.icu dashboard)
    const tsb = Math.round((ctl - atl) * 10) / 10;

    dates.push(date);
    ctls.push(Math.round(ctl * 10) / 10);
    atls.push(Math.round(atl * 10) / 10);
    tsbs.push(tsb);
  }

  return { dates, ctls, atls, tsbs };
}

/**
 * Get today's date as YYYY-MM-DD in Australia/Sydney timezone.
 * All activity dates in the DB are converted to AEST, so the timeline end
 * must use the same timezone to stay aligned.
 */
function todayAest(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
}

/**
 * Build a complete daily TSS timeline from the earliest data point to today.
 * Any missing days get TSS = 0, which means the EMA naturally decays on rest
 * days — exactly how intervals.icu works.
 */
function buildFullTimeline(sorted: DailyTSS[]): DailyTSS[] {
  if (sorted.length === 0) return [];
  const result: DailyTSS[] = [];
  // Iterate purely in UTC: dates here are calendar-day strings, so mixing
  // local-time setDate() with UTC toISOString() could skip or duplicate a
  // day when the server timezone crosses a DST transition.
  const cursor = new Date(sorted[0].date + 'T00:00:00Z');
  const end    = new Date(todayAest() + 'T00:00:00Z');
  let i = 0;

  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    if (i < sorted.length && sorted[i].date === key) {
      result.push(sorted[i]);
      i++;
    } else {
      result.push({ date: key, tss: 0 });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

/**
 * Estimate HR-based TSS (HRSS) using a squared-intensity model calibrated
 * to match TSS semantics:
 *
 *   HRSS = duration_hours × 100 × (avg_hr / LTHR)²
 *
 * This is analogous to rTSS (running TSS) which uses (pace / threshold_pace)².
 * It gives ~100 for 1 hour at LTHR, scaling appropriately for lower/higher
 * intensities. Used for activities without power data but with HR data.
 *
 * @param avgHr    Average heart rate for the activity (bpm)
 * @param durationMin Duration in minutes
 * @param lthr     Lactate Threshold Heart Rate (bpm)
 * @param maxHr    Maximum Heart Rate (bpm – used for bounding only)
 */
export function estimateHrTss(
  avgHr: number,
  durationMin: number,
  lthr: number,
  maxHr: number,
): number {
  // Guard: LTHR should be less than max HR and greater than resting
  if (maxHr <= lthr || lthr <= 0 || avgHr <= 0) return 0;

  // Use a squared-intensity model analogous to rTSS:
  //   HRSS = duration_hours × 100 × (avg_hr / LTHR)²
  // This gives ~100 for 1 hour at LTHR, matching TSS semantics.
  const hours = durationMin / 60;
  const ratio = avgHr / lthr;
  const hrss = hours * 100 * ratio * ratio;
  return Math.round(hrss);
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

  // Use AEST date for cutoff to stay aligned with timeline dates
  const cutoffAest = new Date(todayAest() + 'T00:00:00Z');
  cutoffAest.setUTCDate(cutoffAest.getUTCDate() - daysBack);
  const cutoffStr = cutoffAest.toISOString().slice(0, 10);


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
