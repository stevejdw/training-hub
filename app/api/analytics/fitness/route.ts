import pool from '@/lib/db';
import { calculateFitnessHistory } from '@/lib/fitness';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  // `days` may be a positive integer (capped at 5 years to bound payload size)
  // or 'all' which returns the full TSS history.
  const raw = searchParams.get('days') ?? '180';
  const days = raw === 'all'
    ? 365 * 5
    : Math.min(365 * 5, Math.max(30, Number(raw)));

  const client = await pool.connect();
  try {
    // Use intervals.icu's TSS (icu_tss) from daily_wellness when available,
    // falling back to Strava-calculated TSS from activities.
    // This ensures CTL/ATL/TSB matches what intervals.icu shows.
    const res = await client.query<{ date: string; tss: number }>(`
      WITH strava_tss AS (
        SELECT
          TO_CHAR(start_date AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD') AS date,
          ROUND(SUM(COALESCE(tss, 0)))::int AS tss
        FROM activities
        WHERE tss IS NOT NULL
        GROUP BY 1
      ),
      intervals_tss AS (
        SELECT
          TO_CHAR(date, 'YYYY-MM-DD') AS date,
          ROUND(icu_tss)::int AS tss
        FROM daily_wellness
        WHERE icu_tss IS NOT NULL
      )
      SELECT
        COALESCE(i.date, s.date) AS date,
        COALESCE(i.tss, s.tss, 0) AS tss
      FROM intervals_tss i
      FULL OUTER JOIN strava_tss s ON i.date = s.date
      ORDER BY 1
    `);

    const dailyTss = res.rows.map(r => ({ date: String(r.date), tss: Number(r.tss) }));
    const data = calculateFitnessHistory(dailyTss, days);

    return Response.json({ data });
  } catch (err) {
    console.error('[fitness GET]', err);
    return Response.json({ data: [], error: String(err) });
  } finally {
    client.release();
  }
}
