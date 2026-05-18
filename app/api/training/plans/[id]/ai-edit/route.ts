import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getPlan, replacePlanDays } from '@/lib/training-plans';
import { getProfile, effectiveFtp } from '@/lib/profile';
import { calculateFitness } from '@/lib/fitness';
import pool from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 120;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DOW_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Build a rich context string focused on recent training data for plan generation */
async function buildRichTrainingContext(ftp: number): Promise<string> {
  const ctx: string[] = [];
  const client = await pool.connect();
  try {
    // 1. CTL/ATL/TSB
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
- CTL (fitness): ${fitness.ctl}
- ATL (fatigue): ${fitness.atl}
- TSB (form): ${fitness.tsb}
`);

    // 2. Last 28 days detailed ride data
    const recentRes = await client.query(`
      SELECT
        id,
        TO_CHAR(start_date AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD') AS date,
        name, sport_type, moving_time, distance, total_elevation_gain,
        average_watts, normalized_power, weighted_average_watts,
        average_heartrate, max_heartrate, tss, intensity_factor,
        trainer, suffer_score
      FROM activities
      WHERE start_date >= NOW() - INTERVAL '28 days'
        AND sport_type = ANY(ARRAY['Ride','VirtualRide','GravelRide','MountainBikeRide','EBikeRide','EMountainBikeRide'])
      ORDER BY start_date DESC
    `);
    if (recentRes.rows.length > 0) {
      ctx.push(`## Recent Rides (last 28 days)`);
      for (const r of recentRes.rows) {
        const parts = [
          `${r.date} "${r.name}"`,
          r.moving_time ? `${Math.round(r.moving_time / 60)}min` : null,
          r.distance ? `${(r.distance / 1000).toFixed(1)}km` : null,
          r.total_elevation_gain ? `${Math.round(r.total_elevation_gain)}m` : null,
          r.normalized_power ? `NP ${Math.round(r.normalized_power)}W` : r.average_watts ? `avg ${Math.round(r.average_watts)}W` : null,
          r.tss ? `TSS ${Math.round(r.tss)}` : null,
          r.intensity_factor ? `IF ${r.intensity_factor.toFixed(2)}` : null,
          r.average_heartrate ? `HR ${Math.round(r.average_heartrate)}` : null,
          r.trainer ? '[indoor]' : '[outdoor]',
        ].filter(Boolean);
        ctx.push(`- ${parts.join(' | ')}`);
      }
    }

    // 3. Laps for recent rides
    const recentIds = recentRes.rows.slice(0, 10).map(r => r.id);
    if (recentIds.length > 0) {
      const lapsRes = await client.query(`
        SELECT l.activity_id, l.lap_index, l.name,
               l.moving_time, l.distance,
               l.average_watts, l.normalized_power,
               l.average_heartrate, l.total_elevation_gain
        FROM laps l
        WHERE l.activity_id = ANY($1::bigint[])
        ORDER BY l.activity_id DESC, l.lap_index ASC
      `, [recentIds]);
      if (lapsRes.rows.length > 0) {
        ctx.push(`\n## Lap Data (recent rides)`);
        const lapsByAct = new Map<string, Record<string, unknown>[]>();
        for (const lap of lapsRes.rows) {
          const key = String(lap.activity_id);
          if (!lapsByAct.has(key)) lapsByAct.set(key, []);
          lapsByAct.get(key)!.push(lap);
        }
        for (const [actId, laps] of lapsByAct) {
          ctx.push(`Activity ${actId}:`);
          for (const lap of laps) {
            const parts = [
              `Lap ${Number(lap.lap_index) + 1}`,
              lap.name ? `"${lap.name}"` : null,
              lap.moving_time ? `${Math.round(Number(lap.moving_time) / 60)}min` : null,
              lap.distance ? `${(Number(lap.distance) / 1000).toFixed(1)}km` : null,
              lap.normalized_power ? `NP ${Math.round(Number(lap.normalized_power))}W` : lap.average_watts ? `avg ${Math.round(Number(lap.average_watts))}W` : null,
              lap.average_heartrate ? `HR ${Math.round(Number(lap.average_heartrate))}` : null,
            ].filter(Boolean);
            ctx.push(`  - ${parts.join(' | ')}`);
          }
        }
      }
    }

    // 4. Best power curve
    const powerRes = await client.query(`
      SELECT seconds, MAX(best_watts)::int AS best_watts
      FROM best_power_efforts
      WHERE seconds IN (5, 60, 300, 600, 1200, 3600)
      GROUP BY seconds ORDER BY seconds
    `);
    if (powerRes.rows.length > 0) {
      ctx.push(`\n## Best Power Curve`);
      for (const p of powerRes.rows) {
        const label = p.seconds <= 5 ? 'Sprint (5s)' :
                      p.seconds <= 60 ? '1 min' :
                      p.seconds <= 300 ? '5 min' :
                      p.seconds <= 600 ? '10 min' :
                      p.seconds <= 1200 ? '20 min' : '60 min (FTP proxy)';
        ctx.push(`- ${label}: ${p.best_watts}W`);
      }
    }

    // 5. Weekly summaries for past 12 weeks
    const weeklyRes = await client.query(`
      SELECT
        date_trunc('week', start_date)::date AS week_start,
        COUNT(*) AS rides,
        ROUND(SUM(moving_time) / 3600.0, 1) AS hours,
        ROUND(SUM(COALESCE(tss, hrss, 0))::numeric, 0) AS total_tss,
        ROUND(SUM(distance / 1000.0)::numeric, 0) AS total_km,
        ROUND(SUM(total_elevation_gain)::numeric, 0) AS total_elevation
      FROM activities
      WHERE start_date >= NOW() - INTERVAL '12 weeks'
        AND sport_type = ANY(ARRAY['Ride','VirtualRide','GravelRide','MountainBikeRide','EBikeRide','EMountainBikeRide'])
      GROUP BY week_start
      ORDER BY week_start DESC
    `);
    if (weeklyRes.rows.length > 0) {
      ctx.push(`\n## Weekly Training Volume (last 12 weeks)`);
      for (const w of weeklyRes.rows) {
        ctx.push(`- Week of ${w.week_start}: ${w.rides} rides, ${w.hours}h, ${w.total_km}km, ${w.total_elevation}m, TSS ${w.total_tss}`);
      }
    }

    // 6. Wellness / readiness
    const wellnessRes = await client.query(`
      SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date,
             hrv_rmssd, resting_hr, sleep_score, readiness_score, sleep_secs
      FROM daily_wellness
      WHERE date >= (NOW() AT TIME ZONE 'Australia/Sydney')::date - INTERVAL '14 days'
      ORDER BY date DESC
    `);
    if (wellnessRes.rows.length > 0) {
      ctx.push(`\n## Wellness (last 14 days)`);
      for (const w of wellnessRes.rows) {
        const parts = [
          w.hrv_rmssd != null ? `HRV ${Math.round(w.hrv_rmssd)}` : null,
          w.resting_hr != null ? `RHR ${w.resting_hr}` : null,
          w.readiness_score != null ? `Readiness ${w.readiness_score}` : null,
          w.sleep_score != null ? `SleepScore ${w.sleep_score}` : null,
          w.sleep_secs ? `Sleep ${(w.sleep_secs / 3600).toFixed(1)}h` : null,
        ].filter(Boolean);
        if (parts.length > 0) ctx.push(`- ${w.date}: ${parts.join(' | ')}`);
      }
    }

  } finally {
    client.release();
  }
  return ctx.join('\n');
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const planId = Number(id);
  const { message } = await req.json() as { message: string };

  // Stream NDJSON with heartbeats every 3s so iOS Safari / VPN / proxies
  // don't kill the connection during the ~25s Claude call.
  // See identical pattern in /api/training/generate.
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

      const send = (frame: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(frame) + '\n')); }
        catch { /* stream closed */ }
      };

      try {
        const [plan, profile] = await Promise.all([
          getPlan(planId),
          getProfile(),
        ]);
        if (!plan) { send({ type: 'error', error: 'Plan not found' }); return; }

        const ftp = effectiveFtp(profile);
        const richContext = await buildRichTrainingContext(ftp);
        const weeks = Math.round(plan.days.length / 7);

        // Build current plan summary
        const planSummary = plan.days.map((d, i) => {
          const dow = DOW_NAMES[i % 7];
          return `- ${d.date} (${dow}): ${d.type.toUpperCase()} "${d.title}" ${d.duration_min}min${d.tss_target ? ` TSS ${d.tss_target}` : ''}${d.description ? ` — ${d.description}` : ''}`;
        }).join('\n');

        const planGuidance = profile.ai_training_plan_guidance
          ? `\n## Training Philosophy\n${profile.ai_training_plan_guidance}\n`
          : '';

        const systemPrompt = `You are an expert cycling coach. You have access to the athlete's complete training history and their current training plan.

## Athlete Profile
- Name: ${profile.name}
- FTP: ${ftp}W${profile.weight_kg ? `, ${profile.weight_kg}kg` : ''}
${profile.training_goals ? `- Goals: ${profile.training_goals}` : ''}
${profile.events?.length > 0 ? `- Events: ${profile.events.map((e: { name: string; date: string }) => `${e.name} (${e.date})`).join(', ')}` : ''}
${planGuidance}
## Current Training Data
${richContext}

## Current Plan (${weeks} weeks)
${planSummary}

## Your Task
The athlete wants to modify their training plan. Read their request carefully. Use the training data above to:
1. Review their recent activities — duration, intensity, terrain (elevation), lap data
2. Use this as a baseline for the new plan
3. Identify key sessions and build progressive overload
4. Keep the overall structure (number of weeks, training days per week) the same unless asked to change it

Output ONLY a valid JSON object with no markdown, no code fences, no explanation:
{"goal":"updated goal text","days":[array of 7×N day objects]}

Each day object:
{"date":"YYYY-MM-DD","title":"Short title","type":"rest|endurance|tempo|threshold|vo2max|race|recovery","duration_min":0,"tss_target":0,"description":"Full workout description","segments":[{"type":"warmup|main|cooldown","duration_min":0,"target_np_watts":0,"description":"..."}]}

Rules:
- Rest days: type "rest", duration_min 0, tss_target 0, segments [], description ""
- Non-rest days: include warmup, main, cooldown segments with specific power targets
- FTP=${ftp}W zones: Z2=${Math.round(ftp*0.56)}-${Math.round(ftp*0.75)}W, Tempo=${Math.round(ftp*0.76)}-${Math.round(ftp*0.87)}W, Threshold=${Math.round(ftp*0.88)}-${Math.round(ftp*0.95)}W, VO2=${Math.round(ftp*1.06)}-${Math.round(ftp*1.20)}W
- Be specific with interval structures in descriptions (reps, duration, watts, recovery)
- Progressive overload: increase load through each week, every 4th week is recovery (~60% TSS)
- Keep the same number of days per week and same dates`;

        const messageRes = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: 'user', content: message }],
        });

        const text = messageRes.content[0].type === 'text' ? messageRes.content[0].text : '';

        // Extract JSON
        const firstBracket = text.indexOf('[');
        const lastBracket = text.lastIndexOf(']');
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');

        let jsonText = '';
        if (firstBracket !== -1 && lastBracket > firstBracket) {
          jsonText = text.slice(firstBracket, lastBracket + 1);
        } else if (firstBrace !== -1 && lastBrace > firstBrace) {
          jsonText = text.slice(firstBrace, lastBrace + 1);
        }

        if (!jsonText) {
          send({ type: 'error', error: 'AI returned invalid JSON', raw: text.slice(0, 300) });
          return;
        }

        let parsed: { goal?: string; days?: unknown[] };
        try {
          parsed = JSON.parse(jsonText);
          if (Array.isArray(parsed)) {
            const wrapped = parsed.find(p => p && typeof p === 'object' && 'days' in p);
            if (wrapped) parsed = wrapped as { goal?: string; days?: unknown[] };
            else parsed = { days: parsed };
          }
        } catch {
          send({ type: 'error', error: 'Failed to parse AI response', raw: text.slice(0, 300) });
          return;
        }

        if (!parsed.days || !Array.isArray(parsed.days) || parsed.days.length === 0) {
          send({ type: 'error', error: 'AI returned no days', raw: text.slice(0, 300) });
          return;
        }

        const newGoal = parsed.goal ?? plan.goal;
        await replacePlanDays(planId, newGoal, parsed.days as Parameters<typeof replacePlanDays>[2]);

        send({ type: 'result', ok: true, goal: newGoal, days: parsed.days.length });
      } catch (err) {
        console.error('AI plan edit error:', err);
        send({ type: 'error', error: String(err) });
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
