import pool from '@/lib/db';
import { getProfile } from '@/lib/profile';
import { CYCLING_TYPES } from '@/lib/sport-types';

export const runtime = 'nodejs';

export async function GET() {
  const profile = await getProfile();
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
    `, [profile.weight_kg ?? null, CYCLING_TYPES]);

    return Response.json({
      points: rows.rows.map(r => ({
        date:   String(r.date),
        eftp:   Number(r.eftp),
        vo2max: r.vo2max != null ? Number(r.vo2max) : null,
      })),
      weight: profile.weight_kg ?? null,
    });
  } catch (err) {
    console.error('[eftp-history GET]', err);
    return Response.json({ points: [], weight: null, error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
