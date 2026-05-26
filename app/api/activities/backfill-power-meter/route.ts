import pool from '@/lib/db';
import { getProfile } from '@/lib/profile';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Serial numbers confirmed from FIT data analysis:
// - lr_balance is always null for single-sided (can't measure both sides)
// - lr_balance varies realistically for dual-sided
const WAHOO_SINGLE_SERIALS = new Set([
  '221202903',
]);

function mapPowerMeter(rawString: string | null, serial: string | null): string | null {
  if (!rawString) return null;
  const manufacturer = rawString.split(' ')[0];

  if (manufacturer === 'WAHOO_FITNESS') {
    if (serial && WAHOO_SINGLE_SERIALS.has(serial)) return 'Wahoo POWRLINK Single';
    return 'Wahoo POWRLINK Dual';
  }
  if (manufacturer === '_4IIIIS') return '4iiii';
  if (manufacturer === 'FAVERO_ELECTRONICS') return 'Assioma';
  if (manufacturer === 'SPECIALIZED') return 'Specialized';

  // Unknown: clean up the raw string (e.g. "SOME_MFR 123" → "SOME_MFR 123")
  return rawString;
}

/**
 * GET /api/activities/backfill-power-meter
 * Returns counts of activities with/without power meter data.
 */
export async function GET() {
  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE activities ADD COLUMN IF NOT EXISTS power_meter TEXT`);
    await client.query(`ALTER TABLE activities ADD COLUMN IF NOT EXISTS power_meter_serial TEXT`);
    const res = await client.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE power_meter IS NOT NULL)::int AS with_pm,
        COUNT(*) FILTER (WHERE average_watts IS NOT NULL AND power_meter IS NULL)::int AS powered_missing
      FROM activities
    `);
    return Response.json(res.rows[0]);
  } finally {
    client.release();
  }
}

/**
 * POST /api/activities/backfill-power-meter
 * Fetches activities from intervals.icu (which parses raw FIT files) and
 * writes power_meter + power_meter_serial to each matching activity,
 * matched by start_date (UTC).
 *
 * Body: { oldest?: string, newest?: string }
 */
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
  };

  const newest = body.newest ?? new Date().toISOString().split('T')[0];
  const oldest = body.oldest ?? '2015-01-01';

  const auth = Buffer.from(`API_KEY:${apiKey}`).toString('base64');

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

  if (!Array.isArray(icuActivities)) {
    return Response.json({ error: 'Unexpected response from intervals.icu' }, { status: 502 });
  }

  // Filter to only activities with power meter data
  const withPm = icuActivities.filter(a => a.power_meter);

  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE activities ADD COLUMN IF NOT EXISTS power_meter TEXT`);
    await client.query(`ALTER TABLE activities ADD COLUMN IF NOT EXISTS power_meter_serial TEXT`);

    let updated = 0;
    let noMatch = 0;

    for (const act of withPm) {
      const rawPm   = act.power_meter as string | null;
      const serial  = (act.power_meter_serial as string | null) ?? null;
      const startDate = act.start_date as string | null;

      if (!startDate) continue;

      const displayName = mapPowerMeter(rawPm, serial);

      // Match by start_date (UTC) with ±2s tolerance to handle any encoding drift
      const r = await client.query(`
        UPDATE activities
        SET power_meter = $1, power_meter_serial = $2
        WHERE ABS(EXTRACT(EPOCH FROM (start_date - $3::timestamptz))) < 2
          AND (power_meter IS DISTINCT FROM $1 OR power_meter_serial IS DISTINCT FROM $2)
      `, [displayName, serial, startDate]);

      if ((r.rowCount ?? 0) > 0) updated++;
      else noMatch++;
    }

    return Response.json({
      total_icu: icuActivities.length,
      icu_with_power_meter: withPm.length,
      updated,
      no_match: noMatch,
    });
  } finally {
    client.release();
  }
}
