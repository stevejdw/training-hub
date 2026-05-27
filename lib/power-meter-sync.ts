import pool from '@/lib/db';
import { getProfile } from '@/lib/profile';

const WAHOO_SINGLE_SERIALS = new Set(['221202903']);

function mapPowerMeter(rawString: string | null, serial: string | null): string | null {
  if (!rawString) return null;
  const manufacturer = rawString.split(' ')[0];
  if (manufacturer === 'WAHOO_FITNESS') {
    return serial && WAHOO_SINGLE_SERIALS.has(serial) ? 'Wahoo POWRLINK Single' : 'Wahoo POWRLINK Dual';
  }
  if (manufacturer === '_4IIIIS')           return '4iiii';
  if (manufacturer === 'FAVERO_ELECTRONICS') return 'Assioma';
  if (manufacturer === 'SPECIALIZED')       return 'Specialized';
  return rawString;
}

/**
 * Fetch activities from intervals.icu for the given date range and bulk-update
 * power_meter + power_meter_serial on matching activities (matched by start_date ±2s).
 * Returns the number of rows updated.
 */
export async function syncPowerMeters(oldest: string, newest: string): Promise<number> {
  const profile   = await getProfile();
  const athleteId = profile.intervals_athlete_id?.trim();
  const apiKey    = profile.intervals_api_key?.trim();
  if (!athleteId || !apiKey) return 0;

  const auth = Buffer.from(`API_KEY:${apiKey}`).toString('base64');
  const url  = new URL(`https://intervals.icu/api/v1/athlete/${athleteId}/activities`);
  url.searchParams.set('oldest', oldest);
  url.searchParams.set('newest', newest);

  let activities: Record<string, unknown>[];
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return 0;
    activities = await res.json() as Record<string, unknown>[];
  } catch {
    return 0;
  }

  if (!Array.isArray(activities)) return 0;

  const timestamps: string[]        = [];
  const displayNames: string[]      = [];
  const serials: (string | null)[]  = [];

  for (const act of activities) {
    const rawPm    = act.power_meter as string | null;
    const serial   = (act.power_meter_serial as string | null) ?? null;
    const startDate = act.start_date as string | null;
    if (!rawPm || !startDate) continue;
    timestamps.push(startDate);
    displayNames.push(mapPowerMeter(rawPm, serial) ?? rawPm);
    serials.push(serial);
  }

  if (timestamps.length === 0) return 0;

  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE activities ADD COLUMN IF NOT EXISTS power_meter TEXT`);
    await client.query(`ALTER TABLE activities ADD COLUMN IF NOT EXISTS power_meter_serial TEXT`);

    const result = await client.query(`
      UPDATE activities a
      SET power_meter        = u.pm,
          power_meter_serial = u.serial
      FROM unnest($1::timestamptz[], $2::text[], $3::text[]) AS u(ts, pm, serial)
      WHERE ABS(EXTRACT(EPOCH FROM (a.start_date - u.ts))) < 2
        AND (a.power_meter IS DISTINCT FROM u.pm
             OR a.power_meter_serial IS DISTINCT FROM u.serial)
    `, [timestamps, displayNames, serials]);

    return result.rowCount ?? 0;
  } finally {
    client.release();
  }
}
