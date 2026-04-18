import pool from '@/lib/db';

export const runtime = 'nodejs';

// ATL decay constant (7-day)
const K_ATL = 1 - Math.exp(-1 / 7);
// CTL decay constant (42-day)
const K_CTL = 1 - Math.exp(-1 / 42);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  // How many days of history to return (default 180)
  const days = Math.min(365, Math.max(30, Number(searchParams.get('days') ?? 180)));

  const client = await pool.connect();
  try {
    // Fetch daily TSS going back far enough to "warm up" CTL (need ~3× 42d = 126d before window)
    const warmup = 180; // extra days before the display window
    const totalDays = days + warmup;

    const res = await client.query<{ date: string; tss: number }>(`
      SELECT
        (date_trunc('day', start_date AT TIME ZONE 'Australia/Sydney')::date)::text AS date,
        ROUND(SUM(COALESCE(tss, 0)))::int AS tss
      FROM activities
      WHERE start_date >= NOW() - INTERVAL '${totalDays} days'
        AND tss IS NOT NULL
      GROUP BY 1
      ORDER BY 1
    `);

    // Build a date→TSS map
    const tssMap = new Map<string, number>();
    for (const row of res.rows) {
      tssMap.set(row.date, Number(row.tss));
    }

    // Walk every calendar day from (days+warmup) ago to today
    let atl = 0;
    let ctl = 0;
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - totalDays);

    const result: { date: string; atl: number; ctl: number; tsb: number }[] = [];

    for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      const tss = tssMap.get(key) ?? 0;

      // TSB is form: yesterday's CTL - yesterday's ATL
      const tsb = Math.round((ctl - atl) * 10) / 10;

      // Update ATL and CTL for this day
      atl = atl + (tss - atl) * K_ATL;
      ctl = ctl + (tss - ctl) * K_CTL;

      // Only include dates within the display window
      const daysAgo = (today.getTime() - d.getTime()) / 86400000;
      if (daysAgo <= days) {
        result.push({
          date: key,
          atl:  Math.round(atl * 10) / 10,
          ctl:  Math.round(ctl * 10) / 10,
          tsb,
        });
      }
    }

    return Response.json({ data: result });
  } catch (err) {
    console.error('[fitness GET]', err);
    return Response.json({ data: [], error: String(err) });
  } finally {
    client.release();
  }
}
