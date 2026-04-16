import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getProfile, effectiveFtp } from '@/lib/profile';
import pool from '@/lib/db';

export const runtime = 'nodejs';

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

    const systemPrompt = `You are an expert cycling coach creating a structured training plan.
Athlete profile:
- FTP: ${ftp}W
- Weight: ${profile.weight_kg ? profile.weight_kg + 'kg' : 'unknown'}
- Training goals: ${profile.training_goals || 'General fitness'}
- Events: ${profile.events.length > 0 ? profile.events.map(e => `${e.name} on ${e.date} (goal: ${e.goal})`).join(', ') : 'None scheduled'}
- Recent activity: ${recentSummary}

Generate a ${weeks}-week training plan starting ${planStartDate} (Monday) through ${planEndDate}.
Return ONLY valid JSON matching this exact structure — no markdown, no explanation:
{
  "name": "Plan name",
  "goal": "Brief goal statement",
  "days": [
    {
      "date": "YYYY-MM-DD",
      "title": "Session title",
      "type": "rest|endurance|tempo|threshold|vo2max|race|recovery",
      "duration_min": 90,
      "tss_target": 85,
      "description": "Brief overview of the session",
      "segments": [
        {
          "type": "warmup|main|cooldown|interval",
          "duration_min": 15,
          "description": "What to do",
          "target_np_watts": 200,
          "target_avg_hr": 130,
          "zone": "Zone 2",
          "notes": "Optional cues"
        }
      ]
    }
  ]
}

Rules:
- Include ALL ${weeks * 7} days (rest days have type "rest", duration_min 0, empty segments)
- Use athlete's FTP (${ftp}W) for power targets: Z2=55-75%, Z3=76-87%, Threshold=88-95%, VO2=106-120%
- Include warmup and cooldown segments for every non-rest day
- TSS targets should reflect the session type and athlete level
- Vary load: build weeks should increase TSS, every 4th week is recovery`;

    const userPrompt = goal
      ? `Create a ${weeks}-week plan focused on: ${goal}${notes ? '\nAdditional notes: ' + notes : ''}`
      : `Create a balanced ${weeks}-week base fitness plan${notes ? '\nNotes: ' + notes : ''}`;

    const message = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';

    // Strip markdown code fences if present
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

    let planData: { name: string; goal: string; days: unknown[] };
    try {
      planData = JSON.parse(jsonText);
    } catch {
      return Response.json({ error: 'Claude returned invalid JSON', raw: text }, { status: 500 });
    }

    return Response.json(planData);
  } catch (err) {
    console.error('Generate plan error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
