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
      `SELECT watts FROM activity_streams WHERE activity_id = $1`,
      [id]
    );

    if (res.rows.length === 0 || !res.rows[0].watts) {
      return Response.json({ results: [], seconds });
    }

    const watts: number[] = res.rows[0].watts;

    if (watts.length < seconds) {
      return Response.json({ results: [], seconds });
    }

    // Compute rolling averages for every valid window
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
    const results: { rank: number; watts: number; start: number }[] = [];
    const used = new Set<number>();

    for (const { start, avg } of avgs) {
      if (results.length >= 5) break;

      // Check overlap with any already-selected window
      let overlaps = false;
      for (const s of used) {
        if (Math.abs(start - s) < seconds) { overlaps = true; break; }
      }
      if (overlaps) continue;

      used.add(start);
      results.push({ rank: results.length + 1, watts: Math.round(avg), start });
    }

    return Response.json({ results, seconds });
  } finally {
    client.release();
  }
}
