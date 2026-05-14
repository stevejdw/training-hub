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
    // Cache key bumped to v2 when the prompt changed (next-key-session focus).
    const cacheRes = await client.query(
      `SELECT content, last_activity_id FROM coaching_cache WHERE key = 'insight_v6'`
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
`Write me a personal note in plain prose — NO markdown, NO headings, NO bullet points, NO bold. Sound like a real coach talking to a real athlete.

STEP 1 — decide which MODE you're in:
- REVIEW MODE: my MOST RECENT activity (the top of Recent Activities) is a key session (vo2max / threshold / tempo / structured intervals with lap NP data) AND it happened in the last 48 hours. In this mode the note is a post-session debrief.
- PREVIEW MODE: otherwise. The note is preparation for my next key session in the plan.

STEP 2 — REVIEW MODE instructions (only if you chose REVIEW MODE):
- Pull the lap NP numbers from my latest key session. Compute the AVERAGE NP across the working efforts (ignore warm-up/cool-down laps).
- Find my most recent previous session of the same type/structure. Compute its average NP across efforts.
- Compare BOTH: (a) average power across efforts, AND (b) total work done (number of efforts × average watts × time). Example: 4×5min @ 320W is MORE work than 5×5min @ 305W even though there were fewer reps — say so.
- If avg power UP or total work UP → celebrate specifically with both numbers.
- If avg power DOWN or work DOWN meaningfully (>3-5%) → name it honestly. Then diagnose: look at the Wellness section (HRV trend, RHR, sleep hours, readiness) over the days leading into the session, and at CTL/ATL/TSB and recent TSS load. Suggest the most likely cause in one sentence (e.g. "HRV was 38 the morning of the session, well below your 14-day avg of 52 — that's autonomic fatigue, not lost fitness").
- Use the diagnosis to ADJUST the next week's guidance — swap an intensity day for endurance, lower target watts, add a rest day, whatever fits.
- Close with: "I look forward to seeing your results after Friday's session" (or whatever the next key day is).

STEP 3 — PREVIEW MODE instructions:
- Mention my next KEY session by day of week and title.
- Acknowledge how I've been going given CTL/ATL/TSB and the trend in the wellness data (HRV/sleep) if it tells a story.
- Tell me what today's focus should be — specific numbers (e.g. "keep it under 200W today").
- Reference one specific recent strong session by date and numbers to build confidence (or honestly call out the last key session if numbers were down).
- Close with: "I look forward to seeing your results after Friday's session" (use the actual day).

GLOBAL RULES:
- Always end with "I look forward to seeing your results after [day]'s session." Never say "I'll check in".
- Plain prose, no lists, no headings, no markdown.
- Use actual numbers from the data. Don't fabricate.
- 5-7 sentences total. REVIEW MODE can run slightly longer if the diagnosis needs it.

Example REVIEW MODE tone: "Tuesday's 4x8min was a step back from where you've been — you averaged 298W vs 315W on the same workout three weeks ago, and your total work was lower despite the same structure. Your HRV dropped from a 14-day average of 52 to 36 the morning of the session, RHR was up 5bpm, and you only got 5.8h sleep the night before — that's autonomic fatigue, not lost fitness. Let's swap Thursday's tempo for a longer endurance ride at Zone 2 and push the threshold work to next Tuesday when you're rested. Today, keep it under 160W and prioritise sleep. I look forward to seeing your results after Tuesday's session."

Example PREVIEW MODE tone: "Your next key session is this Friday — 20-30min Power. You've been doing really well and your fitness is sitting at a solid 67 with a fresh TSB of +8. Today's all about keeping it easy — stay under 180W so you're sharp for Friday. Your 4x10min on Tuesday averaged 315W, the best you've done at that effort. I look forward to seeing your results after Friday's session."`,
        },
      ],
    });

    const content =
      response.content[0]?.type === 'text' ? response.content[0].text : '';

    // Persist to cache
    await client.query(
      `INSERT INTO coaching_cache (key, content, last_activity_id, generated_at)
       VALUES ('insight_v6', $1, $2, NOW())
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
