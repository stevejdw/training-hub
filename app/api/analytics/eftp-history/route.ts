import pool from '@/lib/db';
import { getProfile } from '@/lib/profile';
import { CYCLING_TYPES } from '@/lib/sport-types';

export const runtime = 'nodejs';

interface IcuActivity {
  start_date?: string;
  icu_ftp?:    number | null;
  icu_vo2max?: number | null;
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

async function fetchFromIntervals(athleteId: string, apiKey: string) {
  const auth    = Buffer.from(`API_KEY:${apiKey}`).toString('base64');
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setFullYear(startDate.getFullYear() - 2);

  const fmt = (d: Date) => d.toISOString().split('T')[0];

  // Fetch year-by-year to avoid per-request result limits
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
      const ftp = a.icu_ftp;
      if (!ftp || ftp <= 0) return false;
      const t = (a.type ?? a.sport_type ?? '').toLowerCase();
      return t.includes('ride') || t.includes('cycling') || t.includes('virtual');
    })
    .map(a => ({
      date:   (a.start_date ?? '').slice(0, 10),
      eftp:   Math.round(a.icu_ftp!),
      vo2max: a.icu_vo2max != null ? Math.round(a.icu_vo2max * 10) / 10 : null,
    }))
    .filter(p => p.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchFromStrava(weightKg: number | null) {
  const client = await pool.connect();
  try {
    const rows = await client.query(`
      SELECT
        TO_CHAR(start_date AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD') AS date,
        ROUND(normalized_power * 0.95)::int AS eftp,
        CASE
          WHEN $1::numeric IS NOT NULL AND $1::numeric > 0
          THEN ROUND(((normalized_power * 0.95 / $1::numeric) * 10.8 + 7)::numeric, 1)
          ELSE NULL
        END AS vo2max
      FROM activities
      WHERE sport_type = ANY($2::text[])
        AND moving_time >= 1200
        AND normalized_power IS NOT NULL
        AND normalized_power > 0
        AND start_date >= NOW() - INTERVAL '2 years'
      ORDER BY start_date ASC
    `, [weightKg ?? null, CYCLING_TYPES]);

    return rows.rows.map(r => ({
      date:   String(r.date),
      eftp:   Number(r.eftp),
      vo2max: r.vo2max != null ? Number(r.vo2max) : null,
    }));
  } finally {
    client.release();
  }
}

export async function GET() {
  const profile   = await getProfile();
  const athleteId = profile.intervals_athlete_id?.trim();
  const apiKey    = profile.intervals_api_key?.trim();

  try {
    if (athleteId && apiKey) {
      const points = await fetchFromIntervals(athleteId, apiKey);
      return Response.json({ points, weight: profile.weight_kg ?? null, source: 'intervals' });
    }
  } catch (err) {
    console.error('[eftp-history] intervals.icu fetch failed, falling back to Strava NP:', err);
  }

  const points = await fetchFromStrava(profile.weight_kg ?? null);
  return Response.json({ points, weight: profile.weight_kg ?? null, source: 'strava' });
}
