import pool from '@/lib/db';
import { getProfile } from '@/lib/profile';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Serial numbers confirmed from FIT data analysis:
// serial 221202903 → lr_balance is always null across all 54 activities = single-sided
const WAHOO_SINGLE_SERIALS = new Set(['221202903']);

function mapPowerMeter(rawString: string | null, serial: string | null): string | null {
  if (!rawString) return null;
  const manufacturer = rawString.split(' ')[0];

  if (manufacturer === 'WAHOO_FITNESS') {
    if (serial && WAHOO_SINGLE_SERIALS.has(serial)) return 'Wahoo POWRLINK Single';
    return 'Wahoo POWRLINK Dual';
  }
  if (manufacturer === '_4IIIIS')          return '4iiii';
  if (manufacturer === 'FAVERO_ELECTRONICS') return 'Assioma';
  if (manufacturer === 'SPECIALIZED')      return 'Specialized';
  return rawString;
}

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

  const body = await req.json().catch(() => ({})) as { oldest?: string; newest?: string };
  const newest = body.newest ?? new Date().toISOString().split('T')[0];
  const oldest = body.oldest ?? '2015-01-01';

  const auth = Buffer.from(`API_KEY:${apiKey}`).toString('base64');
  const url  = new URL(`https://intervals.icu/api/v1/athlete/${athleteId}/activities`);
  url.searchParams.set('oldest', oldest);
  url.searchParams.set('newest', newest);

  let icuActivities: Record<string, unknown>[];
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(25_000),
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

  // Build arrays for a single bulk UPDATE via unnest — avoids 640 sequential queries
  const timestamps: string[] = [];
  const displayNames: string[] = [];
  const serials: (string | null)[] = [];

  for (const act of icuActivities) {
    const rawPm    = act.power_meter as string | null;
    const serial   = (act.power_meter_serial as string | null) ?? null;
    const startDate = act.start_date as string | null;
    if (!rawPm || !startDate) continue;

    timestamps.push(startDate);
    displayNames.push(mapPowerMeter(rawPm, serial) ?? rawPm);
    serials.push(serial);
  }

  if (timestamps.length === 0) {
    return Response.json({
      total_icu: icuActivities.length,
      icu_with_power_meter: 0,
      updated: 0,
    });
  }

  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE activities ADD COLUMN IF NOT EXISTS power_meter TEXT`);
    await client.query(`ALTER TABLE activities ADD COLUMN IF NOT EXISTS power_meter_serial TEXT`);

    // Single bulk UPDATE — match by start_date within ±2s
    const result = await client.query(`
      UPDATE activities a
      SET
        power_meter        = u.pm,
        power_meter_serial = u.serial
      FROM unnest(
        $1::timestamptz[],
        $2::text[],
        $3::text[]
      ) AS u(ts, pm, serial)
      WHERE ABS(EXTRACT(EPOCH FROM (a.start_date - u.ts))) < 2
        AND (a.power_meter IS DISTINCT FROM u.pm
             OR a.power_meter_serial IS DISTINCT FROM u.serial)
    `, [timestamps, displayNames, serials]);

    return Response.json({
      total_icu: icuActivities.length,
      icu_with_power_meter: timestamps.length,
      updated: result.rowCount ?? 0,
    });
  } finally {
    client.release();
  }
}
