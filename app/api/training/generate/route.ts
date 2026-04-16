import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getProfile, effectiveFtp } from '@/lib/profile';
import pool from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 60;

const client = new Anthropic();

function startOfWeekSydney(): string {
  // Get current Sydney date (UTC+10/11 — use +10 simple offset)
  const now = new Date(Date.now() + 10 * 60 * 60 * 1000);
  const dow = now.getUTCDay(); // 0=Sun, 1=Mon...
  const daysFromMon = dow === 0 ? 6 : dow - 1;
  const mon = new Date(now.getTime() - daysFromMon * 86400000);
  return mon.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildSystemPrompt(ftp: number, profile: { weight_kg: number | null; training_goals: string; events: { name: string; date: string }[] }, recentSummary: string, totalWeeks: number, goal: string) {
  return `You are an expert cycling coach. Output ONLY a JSON array — no markdown, no explanation, no code fences.
Athlete: FTP=${ftp}W${profile.weight_kg ? ', ' + profile.weight_kg + 'kg' : ''}. ${profile.training_goals || 'General fitness'}. ${recentSummary}.
Events: ${profile.events.length > 0 ? profile.events.map(e => `${e.name} ${e.date}`).join(', ') : 'none'}.
Goal: ${goal || 'base fitness'}.
Overall plan: ${totalWeeks} weeks total. Build load through weeks; every 4th week is recovery (~60% TSS).

Output a JSON array of exactly 7 day objects (Mon–Sun). Each object:
{"date":"YYYY-MM-DD","title":"Short title","type":"rest|endurance|tempo|threshold|vo2max|race|recovery","duration_min":0,"tss_target":0,"segments":[{"type":"warmup|main|cooldown","duration_min":0,"target_np_watts":0}]}

Rules:
- Rest days: type "rest", duration_min 0, tss_target 0, segments [].
- Non-rest days: exactly 3 segments (warmup, main, cooldown). NO description fields. NO null values — omit optional fields entirely.
- FTP=${ftp}W zones: Z2=${Math.round(ftp*0.56)}-${Math.round(ftp*0.75)}W, Tempo=${Math.round(ftp*0.76)}-${Math.round(ftp*0.87)}W, Threshold=${Math.round(ftp*0.88)}-${Math.round(ftp*0.95)}W, VO2=${Math.round(ftp*1.06)}-${Math.round(ftp*1.20)}W.
- Title max 4 words. Be concise.`;
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
    const { goal = '', weeks = 4, notes = '', weekIndex, planStartDate: bodyStartDate, totalWeeks, planName, planGoal } = body;

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
          ROUND(AVG(COALESCE(tss, 0))::numeric, 0)::int AS avg_tss
        FROM activities
        WHERE start_date >= NOW() - INTERVAL '28 days'
          AND sport_type IN ('Ride', 'VirtualRide', 'GravelRide')
      `);
      const r = res.rows[0];
      recentSummary = `Last 28d: ${r.total} rides, avg ${r.avg_hours}h, ${r.total_km}km, avg TSS ${r.avg_tss}`;
    } finally {
      dbClient.release();
    }

    // Single-week mode (called from client per-week)
    if (typeof weekIndex === 'number') {
      const weekStart = addDays(bodyStartDate, weekIndex * 7);
      const weekEnd = addDays(weekStart, 6);
      const weekNum = weekIndex + 1;

      const systemPrompt = buildSystemPrompt(ftp, profile, recentSummary, totalWeeks, goal);
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
        return Response.json({ error: 'Claude returned invalid JSON', raw: text.slice(0, 300) }, { status: 500 });
      }

      return Response.json({ days, name: planName, goal: planGoal });
    }

    // Legacy single-shot mode (kept for compatibility, 4-week only)
    const planStart = startOfWeekSydney();
    const systemPrompt = buildSystemPrompt(ftp, profile, recentSummary, weeks, goal);
    const userPrompt = `Generate all ${weeks} weeks starting ${planStart}. ${notes ? 'Notes: ' + notes : ''}`;

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
