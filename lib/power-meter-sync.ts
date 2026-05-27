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

async function fetchChunk(
  athleteId: string,
  auth: string,
  oldest: string,
  newest: string,
): Promise<Record<string, unknown>[]> {
  const url = new URL(`https://intervals.icu/api/v1/athlete/${athleteId}/activities`);
  url.searchParams.set('oldest', oldest);
  url.searchParams.set('newest', newest);
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as Record<string, unknown>[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Fetch activities from intervals.icu for the given date range, chunked by year
 * to avoid API result limits, then bulk-update power_meter + power_meter_serial
 * on matching activities (matched by start_date ±60s).
 * Returns the number of rows updated.
 */
export async function syncPowerMeters(oldest: string, newest: string): Promise<number> {
  const profile   = await getProfile();
  const athleteId = profile.intervals_athlete_id?.trim();
  const apiKey    = profile.intervals_api_key?.trim();
  if (!athleteId || !apiKey) return 0;

  const auth = Buffer.from(`API_KEY:${apiKey}`).toString('base64');

  // Fetch year-by-year to avoid per-request result limits in the intervals.icu API
  const allActivities: Record<string, unknown>[] = [];
  let chunkStart = new Date(oldest);
  const endDate  = new Date(newest);

  while (chunkStart <= endDate) {
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setFullYear(chunkEnd.getFullYear() + 1);
    chunkEnd.setDate(chunkEnd.getDate() - 1); // one year minus one day
    if (chunkEnd > endDate) chunkEnd.setTime(endDate.getTime());

    const chunk = await fetchChunk(
      athleteId,
      auth,
      chunkStart.toISOString().split('T')[0],
      chunkEnd.toISOString().split('T')[0],
    );
    allActivities.push(...chunk);

    chunkStart = new Date(chunkEnd);
    chunkStart.setDate(chunkStart.getDate() + 1);
  }

  const timestamps: string[]        = [];
  const displayNames: string[]      = [];
  const serials: (string | null)[]  = [];

  for (const act of allActivities) {
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
      WHERE ABS(EXTRACT(EPOCH FROM (a.start_date - u.ts))) < 60
        AND (a.power_meter IS DISTINCT FROM u.pm
             OR a.power_meter_serial IS DISTINCT FROM u.serial)
    `, [timestamps, displayNames, serials]);

    return result.rowCount ?? 0;
  } finally {
    client.release();
  }
}
