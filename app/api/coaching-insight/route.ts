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
      `SELECT content, last_activity_id FROM coaching_cache WHERE key = 'insight_v2'`
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
      max_tokens: 220,
      system: `You are a cycling coach for ${profile.name}. FTP: ${ftp}W.${personaLine}${feedbackLine}\n\n${trainingContext}`,
      messages: [
        {
          role: 'user',
          content:
            "Identify my next KEY session from the active plan (skip recovery/endurance — pick the next vo2max/threshold/tempo/race day). In 3-4 sentences, tell me what the session is and exactly how to prepare for it given my current CTL/ATL/TSB and recent sessions (sleep, fuelling, intensity to back off from, etc.). Be direct, use actual numbers, no fluff.",
        },
      ],
    });

    const content =
      response.content[0]?.type === 'text' ? response.content[0].text : '';

    // Persist to cache
    await client.query(
      `INSERT INTO coaching_cache (key, content, last_activity_id, generated_at)
       VALUES ('insight_v2', $1, $2, NOW())
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
