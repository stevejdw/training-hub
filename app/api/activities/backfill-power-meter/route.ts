import pool from '@/lib/db';
import { getProfile } from '@/lib/profile';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/activities/backfill-power-meter
 *
 * Fetches activities from intervals.icu (which parses raw FIT files) and
 * extracts power meter device info, then writes it back to the activities table.
 *
 * Body: { oldest?: string, newest?: string, probe?: boolean }
 *   - oldest/newest: ISO date strings (default: all history)
 *   - probe: if true, returns a sample icu activity without writing to DB
 *
 * GET /api/activities/backfill-power-meter
 * Returns { remaining } count of activities missing power_meter data.
 */

export async function GET() {
  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE activities ADD COLUMN IF NOT EXISTS power_meter TEXT`);
    const res = await client.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE power_meter IS NOT NULL)::int AS with_pm,
              COUNT(*) FILTER (WHERE average_watts IS NOT NULL AND power_meter IS NULL)::int AS powered_missing
       FROM activities`
    );
    return Response.json(res.rows[0]);
  } finally {
    client.release();
  }
}

export async function POST(req: Request) {
  const profile = await getProfile();
  const athleteId = profile.intervals_athlete_id?.trim();
  const apiKey    = profile.intervals_api_key?.trim();

  if (!athleteId || !apiKey) {
    return Response.json(
      { error: 'intervals.icu Athlete ID and API Key are required in Settings.' },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({})) as {
    oldest?: string;
    newest?: string;
    probe?: boolean;
  };

  const probe  = body.probe ?? false;
  const newest = body.newest ?? new Date().toISOString().split('T')[0];
  const oldest = body.oldest ?? '2010-01-01';

  const auth = Buffer.from(`API_KEY:${apiKey}`).toString('base64');

  // Fetch activities from intervals.icu for the date range.
  // Use ?cols to request the power meter field alongside the Strava ID.
  // We request several possible field names since the exact name may vary.
  const url = new URL(`https://intervals.icu/api/v1/athlete/${athleteId}/activities`);
  url.searchParams.set('oldest', oldest);
  url.searchParams.set('newest', newest);

  let icuActivities: Record<string, unknown>[];
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: `intervals.icu error ${res.status}: ${text}` }, { status: 502 });
    }
    icuActivities = await res.json() as Record<string, unknown>[];
  } catch (err) {
    return Response.json({ error: `Fetch failed: ${String(err)}` }, { status: 502 });
  }

  if (!Array.isArray(icuActivities) || icuActivities.length === 0) {
    return Response.json({ updated: 0, sample: null, message: 'No activities returned from intervals.icu' });
  }

  // If probing, return the first activity's full field list so we can see exactly
  // what's available — useful for confirming the power meter field name.
  const sampleActivity = icuActivities[0];
  if (probe) {
    return Response.json({
      probe: true,
      total_returned: icuActivities.length,
      sample_fields: Object.keys(sampleActivity),
      sample: sampleActivity,
    });
  }

  // Extract power meter name from whichever field intervals.icu uses.
  // Try several candidate names in priority order.
  function extractPowerMeter(act: Record<string, unknown>): string | null {
    const candidates = [
      'power_meter',
      'icu_power_meter',
      'powerMeter',
      'power_source',
      'powerSource',
    ];
    for (const key of candidates) {
      const val = act[key];
      if (typeof val === 'string' && val.trim()) return val.trim();
    }
    return null;
  }

  // Strava activity ID is stored in intervals.icu as strava_id (or externalId).
  function extractStravaId(act: Record<string, unknown>): number | null {
    const raw = act.strava_id ?? act.stravaId ?? act.external_id ?? act.externalId;
    if (raw === null || raw === undefined) return null;
    const n = Number(raw);
    return isFinite(n) && n > 0 ? n : null;
  }

  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE activities ADD COLUMN IF NOT EXISTS power_meter TEXT`);

    let updated = 0;
    let skipped = 0;
    let noStravaId = 0;
    let noPowerMeter = 0;

    for (const act of icuActivities) {
      const stravaId    = extractStravaId(act);
      const powerMeter  = extractPowerMeter(act);

      if (!stravaId) { noStravaId++; continue; }
      if (!powerMeter) { noPowerMeter++; continue; }

      const r = await client.query(
        `UPDATE activities SET power_meter = $1
         WHERE id = $2 AND power_meter IS DISTINCT FROM $1`,
        [powerMeter, stravaId]
      );
      if ((r.rowCount ?? 0) > 0) updated++;
      else skipped++;
    }

    // Show which power meter field names were found in the sample
    const foundFields = Object.keys(sampleActivity).filter(k =>
      k.toLowerCase().includes('power') || k.toLowerCase().includes('device')
    );

    return Response.json({
      total_icu: icuActivities.length,
      updated,
      skipped,
      no_strava_id: noStravaId,
      no_power_meter: noPowerMeter,
      sample_power_fields: foundFields,
      sample_first: {
        fields_checked: ['power_meter', 'icu_power_meter', 'powerMeter', 'power_source', 'powerSource'],
        values: Object.fromEntries(
          ['power_meter', 'icu_power_meter', 'powerMeter', 'power_source', 'powerSource',
           'strava_id', 'stravaId'].map(k => [k, sampleActivity[k] ?? null])
        ),
      },
    });
  } finally {
    client.release();
  }
}
