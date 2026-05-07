import pool from '@/lib/db';
import { calculateFitnessHistory } from '@/lib/fitness';

export const runtime = 'nodejs';

// Match intervals.icu — CTL/ATL/TSB is typically computed from cycling-only TSS.
// If you want all sports included, change this array.
const FITNESS_SPORT_TYPES = ['Ride', 'VirtualRide', 'GravelRide', 'EBikeRide', 'MountainBikeRide'];

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
    // Fetch daily cycling TSS — uses the same sport-type filter as tss-summary
    // to be consistent. Fitness.ts needs full history for warm-up.
    const res = await client.query<{ date: string; tss: number }>(`
      SELECT
        TO_CHAR(start_date AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD') AS date,
        ROUND(SUM(COALESCE(tss, 0)))::int AS tss
      FROM activities
      WHERE tss IS NOT NULL
        AND sport_type = ANY($1::text[])
      GROUP BY 1
      ORDER BY 1
    `, [FITNESS_SPORT_TYPES]);

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
