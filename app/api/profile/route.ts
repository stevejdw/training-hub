import { getProfileFull, saveProfile } from '@/lib/profile';
import type { AthleteProfile } from '@/lib/profile';

export const runtime = 'nodejs';

/**
 * The intervals.icu API key lives in the athlete_profile JSONB blob, and this
 * route serves that whole blob to the browser so the client can edit and PUT
 * it back. That meant the key round-tripped to the client on every page load.
 * It never leaves the server now: GET reports only whether one is set, and PUT
 * treats an absent or empty key as "unchanged" so the round-trip can't blank
 * the stored value.
 */

export async function GET() {
  try {
    // Full profile: the client edits this object and PUTs it back, so it must
    // include events[].route or saveProfile would drop the geometry.
    const profile = await getProfileFull();
    const { intervals_api_key, ...safe } = profile;
    return Response.json({ ...safe, intervals_api_key_set: !!intervals_api_key?.trim() });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as AthleteProfile & { intervals_api_key_set?: boolean };
    // Response-only field — never persist it into the blob.
    delete body.intervals_api_key_set;

    if (!body.intervals_api_key?.trim()) {
      // The client didn't send a key (it never received one). Keep what's
      // stored rather than wiping it.
      const current = await getProfileFull();
      if (current.intervals_api_key) body.intervals_api_key = current.intervals_api_key;
      else delete body.intervals_api_key;
    }

    await saveProfile(body);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
