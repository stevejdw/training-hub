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
      `SELECT content, last_activity_id FROM coaching_cache WHERE key = 'insight_v3'`
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

    const personaLine = profile.coach_persona
      ? `\n${profile.coach_persona}\n`
      : '';

    const feedbackLine = profile.ai_coaching_feedback
      ? `\n## Feedback Style\n${profile.ai_coaching_feedback}\n`
      : '';

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 260,
      system: `You are ${profile.name}'s personal cycling coach. You know them well and you talk to them like a real coach — warm, encouraging, conversational. FTP: ${ftp}W.${personaLine}${feedbackLine}\n\n${trainingContext}`,
      messages: [
        {
          role: 'user',
          content:
`Write me a short personal note (4-6 sentences, plain prose — NO markdown, NO headings, NO bullet points, NO bold) that sounds like a real coach checking in.

Structure it like this, but in natural flowing sentences:
1. Mention my next KEY session by day of week and its title (skip recovery/endurance — pick the next vo2max/threshold/tempo/race day in the plan).
2. Acknowledge how I've been going given my CTL/ATL/TSB.
3. Tell me what today's focus should be — be specific with numbers (e.g. "keep it under 200W today" or "stay in Zone 2").
4. Call out one specific recent session that shows I'm improving — name the date or day and the actual numbers.
5. End with a warm sign-off mentioning the next session ("I'll check in after Friday's session" or similar).

Example tone: "Your next key session is this Friday — 20-30min Power. You've been doing really well and your fitness is sitting at a solid 67. Today's all about keeping it easy — stay under 180W so you're fresh for Friday. Your numbers on Tuesday's 4x10min were the best you've ever done at that effort, averaging 315W. I'll check in after Friday's session."`,
        },
      ],
    });

    const content =
      response.content[0]?.type === 'text' ? response.content[0].text : '';

    // Persist to cache
    await client.query(
      `INSERT INTO coaching_cache (key, content, last_activity_id, generated_at)
       VALUES ('insight_v3', $1, $2, NOW())
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
