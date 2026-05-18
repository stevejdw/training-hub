import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getProfile, effectiveFtp } from '@/lib/profile';
import { calculateFitness } from '@/lib/fitness';
import pool from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 60;

const client = new Anthropic();

function startOfWeekSydney(): string {
  const now = new Date(Date.now() + 10 * 60 * 60 * 1000);
  const dow = now.getUTCDay();
  const daysFromMon = dow === 0 ? 6 : dow - 1;
  const mon = new Date(now.getTime() - daysFromMon * 86400000);
  return mon.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const DOW_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface DaySetting { maxMinutes: number; isGroupRide: boolean }
type DaySettingsMap = Record<number, DaySetting>;

/** Build rich context for the AI: recent fitness, power curve, readiness, etc. */
async function buildRichContext(ftp: number): Promise<string> {
  const ctx: string[] = [];
  const client = await pool.connect();
  try {
    // 1. CTL/ATL/TSB — current fitness state
    const dailyTssRes = await client.query(`
      WITH strava_tss AS (
        SELECT TO_CHAR(start_date AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD') AS date,
               SUM(COALESCE(tss, hrss, 0)) AS tss
        FROM activities GROUP BY 1
      ),
      intervals_tss AS (
        SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date, icu_tss AS tss
        FROM daily_wellness WHERE icu_tss IS NOT NULL
      )
      SELECT COALESCE(i.date, s.date) AS date, COALESCE(i.tss, s.tss, 0) AS tss
      FROM intervals_tss i FULL OUTER JOIN strava_tss s ON i.date = s.date
      ORDER BY 1
    `);
    const dailyTss = dailyTssRes.rows.map(r => ({ date: String(r.date), tss: Number(r.tss) }));
    const fitness = calculateFitness(dailyTss);
    ctx.push(`## Current Fitness
- CTL (chronic training load / fitness): ${fitness.ctl}
- ATL (acute training load / fatigue): ${fitness.atl}
- TSB (training stress balance / form): ${fitness.tsb}${fitness.tsb >= 5 ? ' (fresh)' : fitness.tsb <= -20 ? ' (fatigued)' : ' (neutral)'}
`);

    // 2. Recent 28-day detailed activity summary (with power data)
    const recentRes = await client.query(`
      SELECT COUNT(*)::int AS total,
        ROUND(AVG(moving_time)::numeric / 3600.0, 1) AS avg_hours,
        ROUND(SUM(distance)::numeric / 1000.0, 0)::int AS total_km,
        ROUND(AVG(COALESCE(tss, hrss, 0))::numeric, 0)::int AS avg_tss,
        ROUND(AVG(COALESCE(normalized_power, average_watts, 0))::numeric, 0)::int AS avg_np,
        ROUND(AVG(COALESCE(intensity_factor, 0))::numeric, 2)::float AS avg_if
      FROM activities
      WHERE start_date >= NOW() - INTERVAL '28 days'
        AND sport_type = ANY(ARRAY['Ride','VirtualRide','GravelRide','MountainBikeRide','EBikeRide','EMountainBikeRide'])
    `);
    const r = recentRes.rows[0];
    ctx.push(`## Recent Training (last 28 days)
- ${r.total} rides, avg ${r.avg_hours}h, ${r.total_km}km total
- Avg TSS ${r.avg_tss} per ride, Avg NP ${r.avg_np}W, Avg IF ${r.avg_if}
`);

    // 3. Readiness / HRV from daily_wellness
    const readinessRes = await client.query(`
      SELECT ROUND(AVG(readiness_score)::numeric, 0)::int AS avg_readiness,
             ROUND(AVG(hrv_rmssd)::numeric, 0)::int AS avg_hrv
      FROM daily_wellness
      WHERE date >= NOW() - INTERVAL '14 days'
        AND (
          readiness_score IS NOT NULL
          OR hrv_rmssd IS NOT NULL
        )
    `);
    const rdy = readinessRes.rows[0];
    if (rdy && (rdy.avg_readiness || rdy.avg_hrv)) {
      ctx.push(`## Readiness (last 14 days)
- Avg readiness: ${rdy.avg_readiness ?? 'N/A'}/10
- Avg morning HRV: ${rdy.avg_hrv ?? 'N/A'}ms
`);
    }

    // 4. Best power curve (top efforts)
    const powerRes = await client.query(`
      SELECT seconds, MAX(best_watts)::int AS best_watts
      FROM best_power_efforts
      WHERE seconds IN (5, 60, 300, 600, 1200, 3600)
      GROUP BY seconds
      ORDER BY seconds
    `);
    if (powerRes.rows.length > 0) {
      const powerLines = powerRes.rows.map(p => {
        const label = p.seconds <= 5 ? 'Sprint (5s)' :
                      p.seconds <= 60 ? '1 min' :
                      p.seconds <= 300 ? '5 min' :
                      p.seconds <= 600 ? '10 min' :
                      p.seconds <= 1200 ? '20 min' : '60 min (FTP proxy)';
        return `- ${label}: ${p.best_watts}W`;
      });
      ctx.push(`## Best Power Curve\n${powerLines.join('\n')}\n`);
    }

    // 5. TSS plan config if set
    const profile = await getProfile();
    if (profile.tss_plan && profile.tss_plan.mode) {
      const tss = profile.tss_plan;
      ctx.push(`## TSS Plan Targets
- Mode: ${tss.mode}
- Starting TSS: ${tss.starting_tss}
- Weekly increase: ${tss.weekly_increase_pct}%
- Block weeks: ${tss.block_weeks} (final week is recovery at ${tss.recovery_pct}% of build week)
- Anchor date: ${tss.anchor_date}
`);
    }
  } finally {
    client.release();
  }
  return ctx.join('\n');
}

function buildSystemPrompt(
  ftp: number,
  profile: { weight_kg: number | null; training_goals: string; events: { name: string; date: string }[]; ai_training_plan_guidance?: string | null },
  recentSummary: string,
  richContext: string,
  totalWeeks: number,
  goal: string,
  trainingDays: number[],
  daySettings: DaySettingsMap = {},
  weeklyTssTarget: number | null = null,
) {
  const dayNames = trainingDays.length > 0
    ? trainingDays.map(d => DOW_NAMES[d]).join(', ')
    : 'any days';

  const dayConstraints = trainingDays.map(d => {
    const s = daySettings[d];
    if (!s) return null;
    const hrs = s.maxMinutes >= 60 ? `${s.maxMinutes / 60}h` : `${s.maxMinutes}min`;
    const flag = s.isGroupRide ? ' (GROUP RIDE — use steady Z2/tempo pace, no structured intervals)' : '';
    return `- ${DOW_NAMES[d]}: up to ${hrs}${flag}`;
  }).filter(Boolean).join('\n');

  const planGuidance = profile.ai_training_plan_guidance
    ? `\n## Training Philosophy\n${profile.ai_training_plan_guidance}\n`
    : '';

  const tssTargetGuidance = weeklyTssTarget && weeklyTssTarget > 0
    ? `\nWeekly TSS target for a build week: ~${weeklyTssTarget} TSS. Distribute this across the listed training days, with the largest sessions on the longest available days. Recovery weeks (every 4th week) should be ~60% of this.\n`
    : '';

  return `You are an expert cycling coach. Output ONLY a JSON array — no markdown, no explanation, no code fences.
Athlete: FTP=${ftp}W${profile.weight_kg ? ', ' + profile.weight_kg + 'kg' : ''}. ${profile.training_goals || 'General fitness'}.
${recentSummary}
${richContext}
Events: ${profile.events.length > 0 ? profile.events.map(e => `${e.name} ${e.date}`).join(', ') : 'none'}.
Goal: ${goal || 'base fitness'}.
${planGuidance}${tssTargetGuidance}
Overall plan: ${totalWeeks} weeks total. Build load through weeks; every 4th week is recovery (~60% TSS).
Training days: ${dayNames}. ALL other days MUST be type "rest".
${dayConstraints ? `\nDay constraints:\n${dayConstraints}\nNever exceed the listed available time per day. For group ride days, use endurance/tempo type and steady power targets.` : ''}

Output a JSON array of exactly 7 day objects (Mon–Sun). Each object:
{"date":"YYYY-MM-DD","title":"Short title","type":"rest|endurance|tempo|threshold|vo2max|race|recovery","duration_min":0,"tss_target":0,"segments":[{"type":"warmup|main|cooldown","duration_min":0,"target_np_watts":0,"description":"..."}]}

Rules:
- Rest days: type "rest", duration_min 0, tss_target 0, segments [].
- Non-rest days: exactly 3 segments (warmup, main, cooldown). NO null values — omit optional fields entirely.
- FTP=${ftp}W zones: Z2=${Math.round(ftp*0.56)}-${Math.round(ftp*0.75)}W, Tempo=${Math.round(ftp*0.76)}-${Math.round(ftp*0.87)}W, Threshold=${Math.round(ftp*0.88)}-${Math.round(ftp*0.95)}W, VO2=${Math.round(ftp*1.06)}-${Math.round(ftp*1.20)}W.
- Warmup/cooldown description: 5 words max (e.g. "Easy spin, build gradually").
- Main set description: give the FULL interval structure. Examples:
  Threshold: "4x8min @ ${Math.round(ftp*0.92)}W / 3min @ ${Math.round(ftp*0.6)}W recovery"
  Over-unders: "3x(2min @ ${Math.round(ftp*1.05)}W + 1min @ ${Math.round(ftp*0.88)}W) x4, 5min recovery between sets"
  VO2max: "6x4min @ ${Math.round(ftp*1.12)}W / 4min easy"
  Endurance: "Steady ride at ${Math.round(ftp*0.65)}W, include 3x5min @ ${Math.round(ftp*0.80)}W mid-ride"
  Tempo: "2x20min @ ${Math.round(ftp*0.83)}W / 5min easy"
  Include reps, duration, watts, recovery. Be specific and prescriptive.
- Title max 4 words.`;
}

function extractJson(text: string): string {
  // Try array first, then object
  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    return text.slice(firstBracket, lastBracket + 1);
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  return text.trim();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { goal = '', weeks = 4, notes = '', weekIndex, planStartDate: bodyStartDate, totalWeeks, planName, planGoal, trainingDays = [], daySettings = {}, weeklyTssTarget = null } = body;

    const profile = await getProfile();
    const ftp = effectiveFtp(profile);

    // Fetch recent activity summary
    const dbClient = await pool.connect();
    let recentSummary = '';
    try {
      const res = await dbClient.query(`
        SELECT COUNT(*)::int AS total,
          ROUND(AVG(moving_time)::numeric / 3600.0, 1) AS avg_hours,
          ROUND(SUM(distance)::numeric / 1000.0, 0)::int AS total_km,
          ROUND(AVG(COALESCE(tss, hrss, 0))::numeric, 0)::int AS avg_tss
        FROM activities
        WHERE start_date >= NOW() - INTERVAL '28 days'
          AND sport_type = ANY(ARRAY['Ride','VirtualRide','GravelRide','MountainBikeRide','EBikeRide','EMountainBikeRide'])
      `);
      const r = res.rows[0];
      recentSummary = `Last 28d: ${r.total} rides, avg ${r.avg_hours}h, ${r.total_km}km, avg TSS ${r.avg_tss}`;
    } finally {
      dbClient.release();
    }

    // Single-week mode (called from client per-week).
    // Returns NDJSON stream with heartbeats every 3s to keep the connection
    // alive through iOS Safari / VPN / proxy idle timeouts (which kill
    // requests that don't transmit data for ~15s).
    if (typeof weekIndex === 'number') {
      const weekStart = addDays(bodyStartDate, weekIndex * 7);
      const weekEnd = addDays(weekStart, 6);
      const weekNum = weekIndex + 1;

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          let finished = false;
          const heartbeat = setInterval(() => {
            if (!finished) {
              try { controller.enqueue(encoder.encode(JSON.stringify({ type: 'heartbeat' }) + '\n')); }
              catch { /* stream closed */ }
            }
          }, 3000);

          try {
            const richContext = await buildRichContext(ftp);
            const systemPrompt = buildSystemPrompt(ftp, profile, recentSummary, richContext, totalWeeks, goal, trainingDays, daySettings, weeklyTssTarget);
            const userPrompt = `Generate week ${weekNum} of ${totalWeeks} (${weekStart} to ${weekEnd}). Week ${weekNum} load level: ${weekNum % 4 === 0 ? 'recovery (60% of peak TSS)' : weekNum % 4 === 1 ? 'build 1' : weekNum % 4 === 2 ? 'build 2' : 'peak'}. ${notes ? 'Notes: ' + notes : ''}`;

            const message = await client.messages.create({
              model: 'claude-sonnet-4-6',
              max_tokens: 2000,
              system: systemPrompt,
              messages: [{ role: 'user', content: userPrompt }],
            });

            const text = message.content[0].type === 'text' ? message.content[0].text : '';
            const jsonText = extractJson(text);

            let days: unknown[];
            try {
              days = JSON.parse(jsonText);
              if (!Array.isArray(days)) days = (days as { days: unknown[] }).days ?? [];
            } catch {
              controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', error: 'Claude returned invalid JSON', raw: text.slice(0, 300) }) + '\n'));
              return;
            }

            controller.enqueue(encoder.encode(JSON.stringify({ type: 'result', days, name: planName, goal: planGoal }) + '\n'));
          } catch (err) {
            controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', error: String(err) }) + '\n'));
          } finally {
            finished = true;
            clearInterval(heartbeat);
            try { controller.close(); } catch { /* already closed */ }
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type':      'application/x-ndjson',
          'Cache-Control':     'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    // Legacy single-shot mode (kept for compatibility, 4-week only)
    const planStart = startOfWeekSydney();
    const richContext = await buildRichContext(ftp);
    const systemPrompt = buildSystemPrompt(ftp, profile, recentSummary, richContext, weeks, goal, trainingDays, daySettings, weeklyTssTarget);

    const allDays: unknown[] = [];
    const name = `${weeks}-Week Plan${goal ? ': ' + goal.slice(0, 40) : ''}`;
    const planGoalStr = goal || 'Base fitness';

    for (let w = 0; w < weeks; w++) {
      const weekStart = addDays(planStart, w * 7);
      const weekEnd = addDays(weekStart, 6);
      const weekNum = w + 1;
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: `Week ${weekNum} of ${weeks} (${weekStart} to ${weekEnd}). Load: ${weekNum % 4 === 0 ? 'recovery' : 'build'}. ${notes}` }],
      });
      const t = msg.content[0].type === 'text' ? msg.content[0].text : '';
      try {
        const parsed = JSON.parse(extractJson(t));
        allDays.push(...(Array.isArray(parsed) ? parsed : parsed.days ?? []));
      } catch { /* skip malformed week */ }
    }

    return Response.json({ name, goal: planGoalStr, days: allDays });
  } catch (err) {
    console.error('Generate plan error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
