import pool from '@/lib/db';
import { getProfile } from '@/lib/profile';
import { CYCLING_TYPES } from '@/lib/sport-types';

export const runtime = 'nodejs';

interface IcuActivity {
  start_date?: string;
  icu_ftp?:    number | null;
  type?:       string;
  sport_type?: string;
}

async function fetchChunk(
  athleteId: string,
  auth: string,
  oldest: string,
  newest: string,
): Promise<IcuActivity[]> {
  const url = new URL(`https://intervals.icu/api/v1/athlete/${athleteId}/activities`);
  url.searchParams.set('oldest', oldest);
  url.searchParams.set('newest', newest);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Basic ${auth}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`intervals.icu API ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function fetchEftpFromIntervals(athleteId: string, apiKey: string) {
  const auth      = Buffer.from(`API_KEY:${apiKey}`).toString('base64');
  const endDate   = new Date();
  const startDate = new Date(endDate);
  startDate.setFullYear(startDate.getFullYear() - 2);
  const fmt = (d: Date) => d.toISOString().split('T')[0];

  const allActivities: IcuActivity[] = [];
  let chunkStart = new Date(startDate);
  while (chunkStart <= endDate) {
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setFullYear(chunkEnd.getFullYear() + 1);
    chunkEnd.setDate(chunkEnd.getDate() - 1);
    if (chunkEnd > endDate) chunkEnd.setTime(endDate.getTime());
    const chunk = await fetchChunk(athleteId, auth, fmt(chunkStart), fmt(chunkEnd));
    allActivities.push(...chunk);
    chunkStart = new Date(chunkEnd);
    chunkStart.setDate(chunkStart.getDate() + 1);
  }

  return allActivities
    .filter(a => {
      if (!a.icu_ftp || a.icu_ftp <= 0) return false;
      const t = (a.type ?? a.sport_type ?? '').toLowerCase();
      if (!t) return true;
      const nonCycling = ['run', 'swim', 'walk', 'hike', 'ski', 'row', 'yoga', 'weight'];
      return !nonCycling.some(x => t.includes(x));
    })
    .map(a => ({
      date: (a.start_date ?? '').slice(0, 10),
      eftp: Math.round(a.icu_ftp!),
    }))
    .filter(p => p.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchEftpFromStrava() {
  const client = await pool.connect();
  try {
    const rows = await client.query(`
      SELECT
        TO_CHAR(start_date AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD') AS date,
        ROUND(normalized_power * 0.95)::int AS eftp
      FROM activities
      WHERE sport_type = ANY($1::text[])
        AND moving_time >= 1200
        AND normalized_power IS NOT NULL
        AND normalized_power > 0
        AND start_date >= NOW() - INTERVAL '2 years'
      ORDER BY start_date ASC
    `, [CYCLING_TYPES]);
    return rows.rows.map(r => ({ date: String(r.date), eftp: Number(r.eftp) }));
  } finally {
    client.release();
  }
}

// VO2 max always from Strava per-ride NP so it shows genuine variation
async function fetchVo2FromStrava(weightKg: number) {
  const client = await pool.connect();
  try {
    const rows = await client.query(`
      SELECT
        TO_CHAR(start_date AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD') AS date,
        ROUND(((normalized_power * 0.95 / $1::numeric) * 10.8 + 7)::numeric, 1) AS vo2max
      FROM activities
      WHERE sport_type = ANY($2::text[])
        AND moving_time >= 1200
        AND normalized_power IS NOT NULL
        AND normalized_power > 0
        AND start_date >= NOW() - INTERVAL '2 years'
      ORDER BY start_date ASC
    `, [weightKg, CYCLING_TYPES]);
    return rows.rows.map(r => ({ date: String(r.date), vo2max: Number(r.vo2max) }));
  } finally {
    client.release();
  }
}

export async function GET() {
  const profile   = await getProfile();
  const athleteId = profile.intervals_athlete_id?.trim();
  const apiKey    = profile.intervals_api_key?.trim();
  const weightKg  = profile.weight_kg ?? null;

  // eFTP: prefer intervals.icu (their model), fall back to Strava NP×0.95
  let eftpPoints: { date: string; eftp: number }[] = [];
  let source = 'strava';
  if (athleteId && apiKey) {
    try {
      const pts = await fetchEftpFromIntervals(athleteId, apiKey);
      if (pts.length > 0) { eftpPoints = pts; source = 'intervals'; }
    } catch (err) {
      console.error('[eftp-history] intervals.icu failed:', err);
    }
  }
  if (eftpPoints.length === 0) {
    eftpPoints = await fetchEftpFromStrava();
  }

  // VO2 max: always per-ride Strava NP so it shows genuine variation
  const vo2Points = weightKg && weightKg > 0
    ? await fetchVo2FromStrava(weightKg)
    : [];

  return Response.json({ eftpPoints, vo2Points, weight: weightKg, source });
}
