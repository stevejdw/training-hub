import pool from '@/lib/db';
import { getProfile } from '@/lib/profile';
import { CYCLING_TYPES } from '@/lib/sport-types';

export const runtime = 'nodejs';

/**
 * eFTP is *estimated* FTP — it must never be the FTP you set in the profile.
 * This chart used to plot intervals.icu's `icu_ftp`, which is the FTP that was
 * in force on that activity, so the line was flat by construction.
 *
 * Instead: for every ride day, take the best power at each key duration over a
 * trailing 42-day window and convert it with the Coggan power-duration
 * multipliers (the same constants as /api/profile/eftp-options), then keep the
 * highest. The curve steps up on a breakthrough effort and decays 42 days later
 * — which is what an FTP estimate should do.
 */
const EFTP_WINDOW_DAYS = 42;

/**
 * VO₂ max. Garmin's own cycling VO₂ max is synced into daily_wellness, so use it
 * whenever it exists. Before Garmin coverage starts, back-fill with the ACSM
 * cycling equation applied to best 5-min power — 5-min power is a proxy for
 * power at VO₂ max, and over the Garmin overlap this lands within ~1-2 points
 * of Garmin's figure. Feeding whole-ride NP into the same formula (the old
 * behaviour) reads ~15 points low because ride NP is nowhere near VO₂ max power.
 */
function vo2FromFiveMinPower(watts: number, weightKg: number): number {
  return Math.round((10.8 * watts / weightKg + 7) * 10) / 10;
}

interface EftpRow { date: string; eftp: number; w5: number | null }

async function fetchEftpSeries(): Promise<EftpRow[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      WITH days AS (
        SELECT DISTINCT (start_date AT TIME ZONE 'Australia/Sydney')::date AS d
        FROM best_power_efforts
        WHERE sport_type = ANY($1::text[])
          AND start_date >= NOW() - INTERVAL '2 years'
      )
      SELECT
        TO_CHAR(days.d, 'YYYY-MM-DD')                            AS date,
        ROUND(GREATEST(w.e5, w.e10, w.e20, w.e60))::int          AS eftp,
        ROUND(w.best5)::int                                      AS w5
      FROM days
      JOIN LATERAL (
        SELECT
          MAX(CASE WHEN seconds = 300  THEN best_watts END)        AS best5,
          MAX(CASE WHEN seconds = 300  THEN best_watts END) * 0.78 AS e5,
          MAX(CASE WHEN seconds = 600  THEN best_watts END) * 0.87 AS e10,
          MAX(CASE WHEN seconds = 1200 THEN best_watts END) * 0.95 AS e20,
          MAX(CASE WHEN seconds = 3600 THEN best_watts END) * 1.00 AS e60
        FROM best_power_efforts b
        WHERE b.sport_type = ANY($1::text[])
          AND (b.start_date AT TIME ZONE 'Australia/Sydney')::date
              BETWEEN days.d - $2::int AND days.d
      ) w ON TRUE
      WHERE GREATEST(w.e5, w.e10, w.e20, w.e60) IS NOT NULL
      ORDER BY days.d ASC
    `, [CYCLING_TYPES, EFTP_WINDOW_DAYS - 1]);

    return res.rows.map(r => ({
      date: String(r.date),
      eftp: Number(r.eftp),
      w5:   r.w5 != null ? Number(r.w5) : null,
    }));
  } finally {
    client.release();
  }
}

async function fetchGarminVo2(): Promise<Map<string, number>> {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date,
             COALESCE(vo2max_cycling, vo2max) AS vo2max
      FROM daily_wellness
      WHERE COALESCE(vo2max_cycling, vo2max) IS NOT NULL
        AND date >= NOW() - INTERVAL '2 years'
      ORDER BY date ASC
    `);
    return new Map(res.rows.map(r => [String(r.date), Number(r.vo2max)]));
  } finally {
    client.release();
  }
}

export async function GET() {
  const profile  = await getProfile();
  const weightKg = profile.weight_kg ?? null;

  const eftpRows = await fetchEftpSeries();
  const eftpPoints = eftpRows.map(r => ({ date: r.date, eftp: r.eftp }));

  // Garmin first, estimate only to back-fill the period before Garmin data starts.
  const garmin = await fetchGarminVo2();
  const garminDates = [...garmin.keys()].sort();
  const garminFrom = garminDates[0] ?? null;

  const vo2Points: { date: string; vo2max: number; source: 'garmin' | 'estimated' }[] = [];
  for (const [date, vo2max] of garmin) {
    vo2Points.push({ date, vo2max, source: 'garmin' });
  }
  if (weightKg && weightKg > 0) {
    for (const r of eftpRows) {
      if (r.w5 == null) continue;
      if (garminFrom && r.date >= garminFrom) continue;
      vo2Points.push({ date: r.date, vo2max: vo2FromFiveMinPower(r.w5, weightKg), source: 'estimated' });
    }
  }
  vo2Points.sort((a, b) => a.date.localeCompare(b.date));

  return Response.json({
    eftpPoints,
    vo2Points,
    weight: weightKg,
    source: 'power-curve',
    vo2GarminFrom: garminFrom,
  });
}
