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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { goal, weeks = 4, notes = '' } = body;

    const profile = await getProfile();
    const ftp = effectiveFtp(profile);

    // Fetch recent activity summary for context
    const dbClient = await pool.connect();
    let recentSummary = '';
    try {
      const res = await dbClient.query(`
        SELECT
          COUNT(*)::int AS total,
          ROUND(AVG(moving_time)::numeric / 3600.0, 1) AS avg_hours,
          ROUND(SUM(distance)::numeric / 1000.0, 0)::int AS total_km,
          ROUND(AVG(COALESCE(tss, 0))::numeric, 0)::int AS avg_tss
        FROM activities
        WHERE start_date >= NOW() - INTERVAL '28 days'
          AND sport_type IN ('Ride', 'VirtualRide', 'GravelRide')
      `);
      const r = res.rows[0];
      recentSummary = `Last 28 days: ${r.total} rides, ${r.avg_hours}h avg duration, ${r.total_km}km total, avg TSS ${r.avg_tss}`;
    } finally {
      dbClient.release();
    }

    const planStartDate = startOfWeekSydney();
    const planEndDate = addDays(planStartDate, weeks * 7 - 1);

    const systemPrompt = `You are an expert cycling coach. Output ONLY a JSON object — no markdown, no explanation, no code fences.
Athlete: FTP=${ftp}W, ${profile.weight_kg ? profile.weight_kg + 'kg' : ''} ${profile.training_goals || 'general fitness'}. ${recentSummary}.
Events: ${profile.events.length > 0 ? profile.events.map(e => `${e.name} ${e.date}`).join(', ') : 'none'}.

JSON structure (EXACTLY this shape, no extra fields):
{"name":"…","goal":"…","days":[{"date":"YYYY-MM-DD","title":"…","type":"rest|endurance|tempo|threshold|vo2max|race|recovery","duration_min":0,"tss_target":0,"description":"…","segments":[{"type":"warmup|main|cooldown|interval","duration_min":0,"description":"…","target_np_watts":0,"target_avg_hr":0}]}]}

Rules:
- ALL ${weeks * 7} days from ${planStartDate}. Rest days: type "rest", duration_min 0, tss_target 0, segments [], description "Rest".
- Power zones from FTP ${ftp}W: Z2=56-75%, Tempo=76-87%, Threshold=88-95%, VO2=106-120%.
- Non-rest days: 3 segments (warmup, main, cooldown). Descriptions max 8 words.
- Build load across weeks; week 4/8/12 = recovery (~60% TSS).
- Omit target_avg_hr if unknown. Use null for unknown numeric fields.`;

    const userPrompt = goal
      ? `Create a ${weeks}-week plan focused on: ${goal}${notes ? '\nAdditional notes: ' + notes : ''}`
      : `Create a balanced ${weeks}-week base fitness plan${notes ? '\nNotes: ' + notes : ''}`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';

    // Extract JSON: find first { to last } to handle any preamble/postamble
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    const jsonText = firstBrace !== -1 && lastBrace > firstBrace
      ? text.slice(firstBrace, lastBrace + 1)
      : text.trim();

    let planData: { name: string; goal: string; days: unknown[] };
    try {
      planData = JSON.parse(jsonText);
    } catch {
      return Response.json({ error: 'Claude returned invalid JSON', raw: text.slice(0, 500) }, { status: 500 });
    }

    return Response.json(planData);
  } catch (err) {
    console.error('Generate plan error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
