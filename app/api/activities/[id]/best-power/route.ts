import pool from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const seconds = parseInt(url.searchParams.get('seconds') ?? '0', 10);

  if (!seconds || seconds < 1) {
    return Response.json({ error: 'seconds param required' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT watts, hr FROM activity_streams WHERE activity_id = $1`,
      [id]
    );

    if (res.rows.length === 0 || !res.rows[0].watts) {
      return Response.json({ results: [], seconds });
    }

    const watts: number[] = res.rows[0].watts;
    const hr: number[] | null = res.rows[0].hr ?? null;

    if (watts.length < seconds) {
      return Response.json({ results: [], seconds });
    }

    // Compute rolling average watts for every valid window
    const n = watts.length;
    const avgs: { start: number; avg: number }[] = new Array(n - seconds + 1);

    let windowSum = 0;
    for (let i = 0; i < seconds; i++) windowSum += (watts[i] ?? 0);
    avgs[0] = { start: 0, avg: windowSum / seconds };

    for (let i = seconds; i < n; i++) {
      windowSum += (watts[i] ?? 0) - (watts[i - seconds] ?? 0);
      avgs[i - seconds + 1] = { start: i - seconds + 1, avg: windowSum / seconds };
    }

    // Sort descending by average
    avgs.sort((a, b) => b.avg - a.avg);

    // Greedily pick top 5 non-overlapping windows
    const selected: { start: number; avg: number }[] = [];
    const used = new Set<number>();

    for (const { start, avg } of avgs) {
      if (selected.length >= 5) break;
      let overlaps = false;
      for (const s of used) {
        if (Math.abs(start - s) < seconds) { overlaps = true; break; }
      }
      if (overlaps) continue;
      used.add(start);
      selected.push({ start, avg });
    }

    // For each selected window compute max watts, avg HR, max HR
    const results = selected.map(({ start, avg }, i) => {
      const slice = watts.slice(start, start + seconds);
      const maxW = Math.max(...slice);

      let avgHr: number | null = null;
      let maxHr: number | null = null;
      if (hr && hr.length >= start + seconds) {
        const hrSlice = hr.slice(start, start + seconds).filter(v => v > 0);
        if (hrSlice.length > 0) {
          avgHr = Math.round(hrSlice.reduce((s, v) => s + v, 0) / hrSlice.length);
          maxHr = Math.max(...hrSlice);
        }
      }

      return {
        rank:     i + 1,
        watts:    Math.round(avg),
        max_watts: maxW,
        avg_hr:   avgHr,
        max_hr:   maxHr,
        start,
      };
    });

    return Response.json({ results, seconds });
  } finally {
    client.release();
  }
}
