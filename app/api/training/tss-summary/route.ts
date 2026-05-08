import pool from '@/lib/db';
import { getProfile, type TssPlanConfig } from '@/lib/profile';

export const runtime = 'nodejs';

const CYCLING_TYPES = ['Ride', 'VirtualRide', 'GravelRide', 'EBikeRide', 'MountainBikeRide'];

/** Moving time above this in a recovery week triggers a duration warning (2.5 h). */
export const RECOVERY_WEEK_LONG_RIDE_SEC = Math.round(2.5 * 3600);

export interface TssWeekPoint {
  week_start:    string;   // YYYY-MM-DD (Monday)
  week_end:      string;   // YYYY-MM-DD (Sunday)
  actual_tss:    number;
  target_tss:    number;
  is_recovery:   boolean;
  target_source: 'plan' | 'formula' | 'none';
  /** True when this week is a formula recovery week but a single ride exceeded RECOVERY_WEEK_LONG_RIDE_SEC. */
  high_duration_recovery_warning: boolean;
}

export interface TssDayPoint {
  date:        string; // YYYY-MM-DD
  day_label:   string; // Mon, Tue, etc.
  actual_tss:  number;
  target_tss:  number;
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

  const startDateStr = fmtDate(ranges[0].start);
  const endDateStr   = fmtDate(ranges[ranges.length - 1].end);

  const client = await pool.connect();
  try {
    // Actual TSS per day (we'll bucket into weeks client-side)
    // Uses COALESCE(tss, hrss, 0) to include HR-based TSS for non-power activities.
    const actualRes = await client.query<{ d: string; tss: string }>(`
      SELECT (start_date AT TIME ZONE $1)::date::text AS d,
             SUM(COALESCE(tss, hrss, 0))::float AS tss
      FROM activities
      WHERE sport_type = ANY($4::text[])
        AND (start_date AT TIME ZONE $1)::date BETWEEN $2 AND $3
      GROUP BY 1
    `, [profile.timezone || 'Australia/Sydney', startDateStr, endDateStr, CYCLING_TYPES]);

    const tssByDate = new Map<string, number>();
    for (const r of actualRes.rows) tssByDate.set(r.d, Number(r.tss));

    const ridesRes = await client.query<{ d: string; moving_time: number }>(`
      SELECT (start_date AT TIME ZONE $1)::date::text AS d, moving_time
      FROM activities
      WHERE sport_type = ANY($4::text[])
        AND moving_time IS NOT NULL
        AND (start_date AT TIME ZONE $1)::date BETWEEN $2 AND $3
    `, [profile.timezone || 'Australia/Sydney', startDateStr, endDateStr, CYCLING_TYPES]);

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

    // Plan targets — sum of training_days.tss_target per day, only when mode='plan' or no config
    let planByDate: Map<string, number> | null = null;
    if (!cfg || cfg.mode === 'plan') {
      const planRes = await client.query<{ d: string; tt: string }>(`
        SELECT date::text AS d, COALESCE(SUM(tss_target), 0)::int AS tt
        FROM training_days
        WHERE plan_id = (SELECT id FROM training_plans ORDER BY created_at DESC LIMIT 1)
          AND date BETWEEN $1 AND $2
        GROUP BY 1
      `, [startDateStr, endDateStr]);
      planByDate = new Map(planRes.rows.map(r => [r.d, Number(r.tt)]));
    }

    // Build week summaries
    const weekPoints: TssWeekPoint[] = ranges.map(({ start, end }) => {
      let actual_tss = 0;
      let plan_tss   = 0;
      const cur = new Date(start);
      while (cur <= end) {
        const k = fmtDate(cur);
        actual_tss += tssByDate.get(k) ?? 0;
        if (planByDate) plan_tss += planByDate.get(k) ?? 0;
        cur.setUTCDate(cur.getUTCDate() + 1);
      }

      let target_tss    = 0;
      let is_recovery   = false;
      let target_source: TssWeekPoint['target_source'] = 'none';

      if (cfg && cfg.mode === 'formula') {
        const { target, isRecovery } = formulaTarget(start, cfg);
        target_tss    = target;
        is_recovery   = isRecovery;
        target_source = 'formula';
      } else if (plan_tss > 0) {
        target_tss    = plan_tss;
        target_source = 'plan';
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
        high_duration_recovery_warning,
      };
    });

    // Build daily points when granularity=day (single week view)
    let dayPoints: TssDayPoint[] | undefined;
    if (granularity === 'day' && ranges.length === 1) {
      const { start, end } = ranges[0];
      // Formula mode has no daily breakdown — daily targets are 0.
      // Plan mode uses the actual per-day targets from the training plan.
      const dayTssTargets = cfg?.mode === 'formula' ? null : planByDate;
      const days: TssDayPoint[] = [];
      const cur = new Date(start);
      let di = 0;
      while (cur <= end) {
        const k = fmtDate(cur);
        days.push({
          date:       k,
          day_label:  DAY_LABELS[di % 7],
          actual_tss: Math.round(tssByDate.get(k) ?? 0),
          target_tss: dayTssTargets ? Math.round(dayTssTargets.get(k) ?? 0) : 0,
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
