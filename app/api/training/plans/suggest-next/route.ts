import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import pool from '@/lib/db';
import { getProfile, effectiveFtp } from '@/lib/profile';
import { calculateFitness } from '@/lib/fitness';
import { getPlan } from '@/lib/training-plans';
import { addDays } from '@/lib/timezone';

export const runtime = 'nodejs';
export const maxDuration = 60;

const client = new Anthropic();

const RIDE_TYPES = ['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide', 'EBikeRide', 'EMountainBikeRide'];

interface SuggestNextResponse {
  focus: string;
  rationale: string;
  suggestedStartDate: string | null;
}

/**
 * Suggests the focus for the athlete's next training block based on how the
 * just-finishing block went (fitness trend + recent power/training load).
 *
 * Used by the "final week" prompt on the Training Plan tab. Returns a short
 * focus line + 2–3 sentence rationale the athlete can drop straight into the
 * Generate Plan modal.
 */
export async function GET(req: NextRequest) {
  try {
    const planId = Number(new URL(req.url).searchParams.get('planId'));
    const profile = await getProfile();
    const ftp = effectiveFtp(profile);

    // Just-finishing plan (for goal continuity + a sensible next start date).
    let finishingGoal = '';
    let suggestedStartDate: string | null = null;
    if (planId) {
      const plan = await getPlan(planId);
      if (plan) {
        finishingGoal = plan.goal || plan.name;
        if (plan.days.length) {
          const endDate = plan.days[plan.days.length - 1].date;
          suggestedStartDate = addDays(endDate, 1);
        }
      }
    }

    const dbClient = await pool.connect();
    let context = '';
    try {
      // Fitness trend (CTL/ATL/TSB)
      const tssRes = await dbClient.query(`
        SELECT TO_CHAR(start_date AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD') AS date,
               SUM(COALESCE(tss, hrss, 0)) AS tss
        FROM activities GROUP BY 1 ORDER BY 1
      `);
      const fitness = calculateFitness(tssRes.rows.map(r => ({ date: String(r.date), tss: Number(r.tss) })));

      // Last block: trailing 28 days of riding
      const recentRes = await dbClient.query(`
        SELECT COUNT(*)::int AS total,
          ROUND(SUM(distance)::numeric / 1000.0, 0)::int AS total_km,
          ROUND(AVG(COALESCE(tss, hrss, 0))::numeric, 0)::int AS avg_tss,
          ROUND(AVG(COALESCE(normalized_power, average_watts, 0))::numeric, 0)::int AS avg_np,
          ROUND(AVG(COALESCE(intensity_factor, 0))::numeric, 2)::float AS avg_if
        FROM activities
        WHERE start_date >= NOW() - INTERVAL '28 days'
          AND sport_type = ANY($1::text[])
      `, [RIDE_TYPES]);
      const r = recentRes.rows[0];

      // Best power curve
      const powerRes = await dbClient.query(`
        SELECT seconds, MAX(best_watts)::int AS best_watts
        FROM best_power_efforts
        WHERE seconds IN (5, 60, 300, 1200)
        GROUP BY seconds ORDER BY seconds
      `);
      const powerLine = powerRes.rows
        .map(p => `${p.seconds <= 5 ? '5s' : p.seconds <= 60 ? '1min' : p.seconds <= 300 ? '5min' : '20min'} ${p.best_watts}W`)
        .join(', ');

      context = `Athlete FTP ${ftp}W${profile.weight_kg ? `, ${profile.weight_kg}kg` : ''}.
Current fitness: CTL ${fitness.ctl}, ATL ${fitness.atl}, TSB ${fitness.tsb} (${fitness.tsb >= 5 ? 'fresh' : fitness.tsb <= -20 ? 'fatigued' : 'neutral'}).
Last 28 days: ${r.total} rides, ${r.total_km}km, avg TSS ${r.avg_tss}/ride, avg NP ${r.avg_np}W, avg IF ${r.avg_if}.
${powerLine ? `Best power: ${powerLine}.` : ''}
Just-finishing block goal: ${finishingGoal || 'general fitness'}.
Upcoming events: ${profile.events.length ? profile.events.map(e => `${e.name} ${e.date}`).join(', ') : 'none'}.`;
    } finally {
      dbClient.release();
    }

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: `You are an expert cycling coach. The athlete is finishing a training block and planning the next one. Based on their data, recommend the focus for the next 4-week block.

Respond with ONLY a JSON object (no markdown, no code fences):
{"focus":"<a concrete focus, max 8 words, e.g. 'Threshold & VO2max sharpening'>","rationale":"<2-3 sentences explaining why, referencing their actual numbers and trend>"}`,
      messages: [{ role: 'user', content: context }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    let parsed: { focus?: string; rationale?: string } = {};
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try { parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1)); } catch { /* fall through */ }
    }

    const res: SuggestNextResponse = {
      focus: parsed.focus?.trim() || 'Build on your current fitness',
      rationale: parsed.rationale?.trim() || 'Keep progressing load while consolidating the gains from your last block.',
      suggestedStartDate,
    };
    return Response.json(res);
  } catch (err) {
    console.error('Suggest next block error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
