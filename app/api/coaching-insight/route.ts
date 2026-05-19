import Anthropic from '@anthropic-ai/sdk';
import pool from '@/lib/db';
import { buildTrainingContext } from '@/lib/training-context';
import { getProfile, effectiveFtp } from '@/lib/profile';

export const runtime = 'nodejs';
export const maxDuration = 30;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * GET /api/coaching-insight
 *
 * Returns a short coaching insight (1–2 sentences).
 * Caches the result in the DB; only regenerates when a new activity
 * has been synced since the last generation.
 */
export async function GET() {
  const client = await pool.connect();
  try {
    // Ensure cache table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS coaching_cache (
        key             TEXT PRIMARY KEY,
        content         TEXT NOT NULL,
        last_activity_id BIGINT,
        generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Latest activity ID — used as a cheap "did anything change?" signal
    const latestRes = await client.query(
      `SELECT MAX(id) AS max_id FROM activities`
    );
    const currentMaxId: number | null = latestRes.rows[0]?.max_id ?? null;

    // Return cached insight if no new activities have been synced.
    const cacheRes = await client.query(
      `SELECT content, last_activity_id FROM coaching_cache WHERE key = 'insight_v7'`
    );
    const cached = cacheRes.rows[0];
    if (cached && String(cached.last_activity_id) === String(currentMaxId)) {
      return Response.json({ content: cached.content, cached: true });
    }

    // Build context and generate a fresh insight
    const [trainingContext, profile] = await Promise.all([
      buildTrainingContext(),
      getProfile(),
    ]);
    const ftp = effectiveFtp(profile);

    // Explicit Sydney date/time so the model never confuses today vs tomorrow
    const sydneyNow = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const sydneyDateISO = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }); // YYYY-MM-DD

    const personaLine = profile.coach_persona
      ? `\n${profile.coach_persona}\n`
      : '';

    const feedbackLine = profile.ai_coaching_feedback
      ? `\n## Feedback Style\n${profile.ai_coaching_feedback}\n`
      : '';

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 420,
      system: `You are ${profile.name}'s personal cycling coach. You know them well and you talk to them like a real coach — warm, encouraging, conversational. FTP: ${ftp}W.${personaLine}${feedbackLine}

IMPORTANT — Current date/time (Sydney/Australia timezone): ${sydneyNow} (${sydneyDateISO}).
Use this as your reference for "today", "yesterday", "tomorrow", and day-of-week references. Any activity or plan day on ${sydneyDateISO} is TODAY. Activities before it are in the past. Plan days after it are in the future. Never refer to today's date as tomorrow.

${trainingContext}`,
      messages: [
        {
          role: 'user',
          content:
`Write me a personal note in plain prose. NO markdown, NO headings, NO bullet points, NO bold, NO mode labels. Sound like a real coach talking to a real athlete.

STEP 1 — decide which situation applies, based on the most recent activity date vs today (${sydneyDateISO}):

A) SESSION DEBRIEF: my most recent activity was within the last 24 hours.
B) TRAINING STATUS: my most recent activity was more than 24 hours ago but less than 3 days ago.
C) DETRAINING: I haven't trained in more than 3 days.

STEP 2 — write accordingly:

If A (SESSION DEBRIEF):
- Analyse the session. Pull lap NP and HR avg/max for each effort lap (ignore warm-up/cool-down laps).
- Compare to my most recent previous session of the same type: average effort NP and total work (reps × avg watts × time). Note which is higher and by how much.
- If it went well → say why, with the specific numbers.
- If it didn't → diagnose honestly. Check HRV trend, RHR, sleep hours in the Wellness section and CTL/ATL/TSB load leading into it. Name the most likely cause in one sentence (e.g. "HRV was 38 that morning, well below your 14-day avg of 52 — autonomic fatigue, not lost fitness"). Prescribe an adjustment to the next week.
- Keep it relaxed and to the point.

If B (TRAINING STATUS):
- Use TSS, CTL, ATL and TSB to describe where my fitness and freshness are right now, with the actual numbers.
- Tell me how ready I am to train today.
- Advise what the next session should focus on and whether that fits my training plan. If a plan adjustment makes sense, say so.
- Reference any notable wellness trend (HRV, sleep) if it adds something.

If C (DETRAINING):
- Be honest but encouraging. Use actual CTL, ATL and TSB numbers to explain what's been happening to fitness and fatigue over this gap.
- Give a clear sense of what has been lost and what hasn't.
- Suggest a specific way to get back on track — intensity, duration, or just showing up.

GLOBAL RULES:
- Do NOT label which situation you chose. Just write the note naturally.
- Plain prose only — no lists, no headings, no markdown.
- Use actual numbers from the data. Don't fabricate.
- 5–7 sentences total. Session debrief can run slightly longer if the diagnosis needs it.
- Always end with: "I look forward to seeing your results after [day]'s session." (use the actual next key session day). Never say "I'll check in".

Example SESSION DEBRIEF tone: "Tuesday's 4×8min was a step back from where you've been — you averaged 298W vs 315W on the same workout three weeks ago, and total work was lower despite the same structure. Your HRV dropped from a 14-day average of 52 to 36 the morning of the session, RHR was up 5bpm, and you only got 5.8h sleep the night before — that's autonomic fatigue, not lost fitness. Let's swap Thursday's tempo for a longer Zone 2 ride and push the threshold work to next Tuesday when you're rested. Today, keep it under 160W and prioritise sleep. I look forward to seeing your results after Tuesday's session."

Example TRAINING STATUS tone: "Your fitness is sitting at CTL 68 with ATL recovering nicely to give you a TSB of +6 — you're in good shape to push quality work. Your next key session is Thursday's threshold intervals, and that lines up well with where you are right now. Today would be a good day for an easy spin under 180W to stay fresh. I look forward to seeing your results after Thursday's session."

Example DETRAINING tone: "It's been four days off the bike and your CTL has slipped from 72 to 68 while ATL has dropped off sharply — the good news is the fatigue is clearing, but you're starting to lose the top end of the fitness you've built. A 60–90 minute easy ride today would be enough to start reversing that trend without digging a hole. I look forward to seeing your results after your next session."`,
        },
      ],
    });

    const content =
      response.content[0]?.type === 'text' ? response.content[0].text : '';

    // Persist to cache
    await client.query(
      `INSERT INTO coaching_cache (key, content, last_activity_id, generated_at)
       VALUES ('insight_v7', $1, $2, NOW())
       ON CONFLICT (key) DO UPDATE
         SET content = EXCLUDED.content,
             last_activity_id = EXCLUDED.last_activity_id,
             generated_at = EXCLUDED.generated_at`,
      [content, currentMaxId]
    );

    return Response.json({ content, cached: false });
  } catch (err) {
    console.error('[coaching-insight GET]', err);
    return Response.json({ content: '', error: String(err) });
  } finally {
    client.release();
  }
}
