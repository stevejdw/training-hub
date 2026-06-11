import pool from '@/lib/db';
import { getProfile, type TssPlanConfig } from '@/lib/profile';
import { CYCLING_TYPES } from '@/lib/sport-types';

export const runtime = 'nodejs';

/** Moving time above this in a recovery week triggers a duration warning (2.5 h). */
export const RECOVERY_WEEK_LONG_RIDE_SEC = Math.round(2.5 * 3600);

export interface TssWeekPoint {
  week_start:    string;   // YYYY-MM-DD (Monday)
  week_end:      string;   // YYYY-MM-DD (Sunday)
  actual_tss:    number;
  target_tss:    number;
  is_recovery:   boolean;
  target_source: 'plan' | 'formula' | 'none';
  distance_m:    number;   // total distance for the week (metres)
  moving_time_s: number;   // total moving time for the week (seconds)
  /** True when this week is a formula recovery week but a single ride exceeded RECOVERY_WEEK_LONG_RIDE_SEC. */
  high_duration_recovery_warning: boolean;
}

export interface TssDayPoint {
  date:          string; // YYYY-MM-DD
  day_label:     string; // Mon, Tue, etc.
  actual_tss:    number;
  target_tss:    number;
  distance_m:    number;  // total distance for the day (metres)
  moving_time_s: number;  // total moving time for the day (seconds)
}

export interface TssSummaryResponse {
  weeks:  TssWeekPoint[];
  days?:  TssDayPoint[];   // present when granularity=day
  config: TssPlanConfig | null;
}

/** Sunday=0, Monday=1...; we want week starting Monday. */
function mondayOf(d: Date): Date {
  const day = d.getUTCDay();
  const diff = (day + 6) % 7; // days since Monday
  const m = new Date(d);
  m.setUTCDate(d.getUTCDate() - diff);
  m.setUTCHours(0, 0, 0, 0);
  return m;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Compute target TSS for a given week using the formula config. */
function formulaTarget(weekStart: Date, cfg: TssPlanConfig): { target: number; isRecovery: boolean } {
  const anchor = new Date(cfg.anchor_date + 'T00:00:00Z');
  const ms     = weekStart.getTime() - anchor.getTime();
  const weeksFromAnchor = Math.round(ms / (7 * 24 * 60 * 60 * 1000));

  const blockSize         = cfg.block_weeks;
  const buildPerBlock     = blockSize - 1;
  // Wrap negative offsets: positionInBlock should be 0..blockSize-1
  const positionInBlock = ((weeksFromAnchor % blockSize) + blockSize) % blockSize;
  const blockNum          = Math.floor(weeksFromAnchor / blockSize);
  const isRecovery        = positionInBlock === blockSize - 1;

  const ratio = 1 + cfg.weekly_increase_pct / 100;

  if (isRecovery) {
    // Recovery: TSS = (last build week of this block) × recovery_pct/100
    const lastBuildElapsed = blockNum * buildPerBlock + (buildPerBlock - 1);
    const buildTarget = cfg.starting_tss * Math.pow(ratio, lastBuildElapsed);
    return { target: Math.round(buildTarget * cfg.recovery_pct / 100), isRecovery: true };
  }

  const buildElapsed = blockNum * buildPerBlock + positionInBlock;
  return {
    target: Math.round(cfg.starting_tss * Math.pow(ratio, buildElapsed)),
    isRecovery: false,
  };
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const weeks = Math.max(1, Math.min(26, Number(searchParams.get('weeks') ?? '4')));
  const offset = Math.max(0, Number(searchParams.get('offset') ?? '0'));
  const granularity = searchParams.get('granularity') ?? 'week';

  // Ride-type filter: comma-separated sport_type values. Unknown values are
  // dropped; an empty/absent param falls back to all cycling types.
  const typesParam = searchParams.get('types');
  const requestedTypes = typesParam
    ? typesParam.split(',').map(s => s.trim()).filter(t => CYCLING_TYPES.includes(t))
    : [];
  const types = requestedTypes.length > 0 ? requestedTypes : CYCLING_TYPES;

  const profile = await getProfile();
  const cfg = profile.tss_plan ?? null;

  // Build list of week ranges ending on the current week (Monday-based), shifted by offset
  const today      = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const thisMon    = mondayOf(today);
  // Shift back by offset weeks
  thisMon.setUTCDate(thisMon.getUTCDate() - offset * 7);
  const ranges: { start: Date; end: Date }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const s = new Date(thisMon);
    s.setUTCDate(thisMon.getUTCDate() - i * 7);
    const e = new Date(s);
    e.setUTCDate(s.getUTCDate() + 6);
    ranges.push({ start: s, end: e });
  }

  // Fetch 4 extra weeks before the display range to compute rolling averages for historical targets
  const ROLLING_LOOKBACK = 4;
  const extendedStart = new Date(ranges[0].start);
  extendedStart.setUTCDate(extendedStart.getUTCDate() - ROLLING_LOOKBACK * 7);

  const startDateStr = fmtDate(ranges[0].start);
  const endDateStr   = fmtDate(ranges[ranges.length - 1].end);
  const extStartDateStr = fmtDate(extendedStart);

  const client = await pool.connect();
  try {
    // Actual TSS per day — fetch from extended start (includes 4 weeks before display range for rolling avg)
    // Uses COALESCE(tss, hrss, 0) to include HR-based TSS for non-power activities.
    const actualRes = await client.query<{ d: string; tss: string; distance: string; moving_time: string }>(`
      SELECT (start_date AT TIME ZONE $1)::date::text AS d,
             SUM(COALESCE(tss, hrss, 0))::float AS tss,
             SUM(COALESCE(distance, 0))::float    AS distance,
             SUM(COALESCE(moving_time, 0))::float AS moving_time
      FROM activities
      WHERE sport_type = ANY($4::text[])
        AND (start_date AT TIME ZONE $1)::date BETWEEN $2 AND $3
      GROUP BY 1
    `, [profile.timezone || 'Australia/Sydney', extStartDateStr, endDateStr, types]);

    const tssByDate  = new Map<string, number>();
    const distByDate = new Map<string, number>();
    const movByDate  = new Map<string, number>();
    for (const r of actualRes.rows) {
      tssByDate.set(r.d, Number(r.tss));
      distByDate.set(r.d, Number(r.distance));
      movByDate.set(r.d, Number(r.moving_time));
    }

    // Build actual TSS per week-start for all weeks in extended range (for rolling avg)
    const actualByWeekStart = new Map<string, number>();
    {
      const cur = new Date(extendedStart);
      while (cur <= ranges[ranges.length - 1].end) {
        const ws = fmtDate(cur);
        let weekTss = 0;
        const day = new Date(cur);
        for (let d = 0; d < 7; d++) {
          weekTss += tssByDate.get(fmtDate(day)) ?? 0;
          day.setUTCDate(day.getUTCDate() + 1);
        }
        actualByWeekStart.set(ws, weekTss);
        cur.setUTCDate(cur.getUTCDate() + 7);
      }
    }

    const ridesRes = await client.query<{ d: string; moving_time: number }>(`
      SELECT (start_date AT TIME ZONE $1)::date::text AS d, moving_time
      FROM activities
      WHERE sport_type = ANY($4::text[])
        AND moving_time IS NOT NULL
        AND (start_date AT TIME ZONE $1)::date BETWEEN $2 AND $3
    `, [profile.timezone || 'Australia/Sydney', startDateStr, endDateStr, types]);

    const maxMovingByWeekStart = new Map<string, number>();
    for (const row of ridesRes.rows) {
      for (const { start, end } of ranges) {
        const ws = fmtDate(start);
        const we = fmtDate(end);
        if (row.d >= ws && row.d <= we) {
          const prev = maxMovingByWeekStart.get(ws) ?? 0;
          if (row.moving_time > prev) maxMovingByWeekStart.set(ws, row.moving_time);
          break;
        }
      }
    }

    // Plan targets — always fetch when an active plan exists so the chart's
    // weekly target stays explicitly linked to the training plan. Formula
    // mode is only used as a fallback when no plan target is present.
    const planRes = await client.query<{ d: string; tt: string }>(`
      SELECT date::text AS d, COALESCE(SUM(tss_target), 0)::int AS tt
      FROM training_days
      WHERE plan_id = (SELECT id FROM training_plans ORDER BY created_at DESC LIMIT 1)
        AND date BETWEEN $1 AND $2
      GROUP BY 1
    `, [startDateStr, endDateStr]);
    const planByDate: Map<string, number> = new Map(planRes.rows.map(r => [r.d, Number(r.tt)]));

    // Build week summaries
    const weekPoints: TssWeekPoint[] = ranges.map(({ start, end }) => {
      let actual_tss    = 0;
      let plan_tss      = 0;
      let distance_m    = 0;
      let moving_time_s = 0;
      const cur = new Date(start);
      while (cur <= end) {
        const k = fmtDate(cur);
        actual_tss    += tssByDate.get(k) ?? 0;
        distance_m    += distByDate.get(k) ?? 0;
        moving_time_s += movByDate.get(k) ?? 0;
        if (planByDate) plan_tss += planByDate.get(k) ?? 0;
        cur.setUTCDate(cur.getUTCDate() + 1);
      }

      let target_tss    = 0;
      let is_recovery   = false;
      let target_source: TssWeekPoint['target_source'] = 'none';

      // Determine if this is a past week (week fully ended before today)
      const isPastWeek = end < today;

      // Plan target wins whenever the active plan has TSS targets for this week.
      // Formula mode only kicks in when the plan has no target for the week.
      if (plan_tss > 0) {
        target_tss    = plan_tss;
        target_source = 'plan';
      } else if (cfg && cfg.mode === 'formula') {
        if (isPastWeek) {
          // For past weeks: use rolling 4-week average of actual TSS from preceding weeks.
          // This gives a meaningful historical baseline rather than projecting the formula backwards.
          let rollingSum = 0;
          let rollingCount = 0;
          for (let w = 1; w <= ROLLING_LOOKBACK; w++) {
            const prevWeekStart = new Date(start);
            prevWeekStart.setUTCDate(start.getUTCDate() - w * 7);
            const prevActual = actualByWeekStart.get(fmtDate(prevWeekStart)) ?? 0;
            if (prevActual > 0) { rollingSum += prevActual; rollingCount++; }
          }
          target_tss = rollingCount > 0 ? Math.round(rollingSum / rollingCount) : 0;
          target_source = 'formula';
        } else {
          const { target, isRecovery } = formulaTarget(start, cfg);
          target_tss    = target;
          is_recovery   = isRecovery;
          target_source = 'formula';
        }
      }

      const ws = fmtDate(start);
      const maxMov = maxMovingByWeekStart.get(ws) ?? 0;
      const high_duration_recovery_warning =
        is_recovery && maxMov > RECOVERY_WEEK_LONG_RIDE_SEC;

      return {
        week_start:    ws,
        week_end:      fmtDate(end),
        actual_tss:    Math.round(actual_tss),
        target_tss,
        is_recovery,
        target_source,
        distance_m:    Math.round(distance_m),
        moving_time_s: Math.round(moving_time_s),
        high_duration_recovery_warning,
      };
    });

    // Build daily points when granularity=day (single week view)
    let dayPoints: TssDayPoint[] | undefined;
    if (granularity === 'day' && ranges.length === 1) {
      const { start, end } = ranges[0];
      // Per-day targets always come from the plan when present;
      // formula mode is week-level only and has no daily breakdown.
      const dayTssTargets = planByDate;
      const days: TssDayPoint[] = [];
      const cur = new Date(start);
      let di = 0;
      while (cur <= end) {
        const k = fmtDate(cur);
        days.push({
          date:          k,
          day_label:     DAY_LABELS[di % 7],
          actual_tss:    Math.round(tssByDate.get(k) ?? 0),
          target_tss:    dayTssTargets ? Math.round(dayTssTargets.get(k) ?? 0) : 0,
          distance_m:    Math.round(distByDate.get(k) ?? 0),
          moving_time_s: Math.round(movByDate.get(k) ?? 0),
        });
        cur.setUTCDate(cur.getUTCDate() + 1);
        di++;
      }
      dayPoints = days;
    }



    return Response.json({ weeks: weekPoints, days: dayPoints, config: cfg } satisfies TssSummaryResponse);
  } finally {
    client.release();
  }
}
