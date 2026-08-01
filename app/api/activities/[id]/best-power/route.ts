import type { PoolClient } from 'pg';
import pool from '@/lib/db';

export const runtime = 'nodejs';

const MAX_RESULTS = 5;

interface Window { start: number; avg: number }

/**
 * Rolling-average power windows, computed inside Postgres.
 *
 * This route used to pull the whole 1 Hz watts+hr arrays (~108 KB per activity
 * view) purely to find five windows. Everything below returns single rows
 * instead, at the cost of a few extra round trips.
 *
 * Window indexing matches the previous in-process implementation: `start` is a
 * 0-based offset into the stream, so a window ending at 1-based ordinality `i`
 * starts at `i - seconds`. Null samples count as zero, as `watts[i] ?? 0` did.
 */
const ROLLING_CTE = `
  WITH s AS (
    SELECT t.ordinality AS i, t.value AS w
      FROM activity_streams,
           unnest(watts) WITH ORDINALITY AS t(value, ordinality)
     WHERE activity_id = $1
  ),
  roll AS (
    SELECT i,
           AVG(COALESCE(w, 0)) OVER win AS avg,
           COUNT(*)            OVER win AS n
      FROM s
    WINDOW win AS (ORDER BY i ROWS BETWEEN $2::int - 1 PRECEDING AND CURRENT ROW)
  )
`;

/**
 * Pick the highest-average window that does not overlap one already chosen.
 *
 * The previous implementation sorted every window descending and walked the
 * list, skipping any whose start fell within `seconds` of an accepted one.
 * Taking the best remaining candidate one at a time is the same greedy choice.
 * Ties break toward the earlier start, matching V8's stable sort on the
 * original ascending-by-start array.
 */
async function pickWindow(
  client: PoolClient,
  activityId: string,
  seconds: number,
  chosen: number[],
): Promise<Window | null> {
  const res = await client.query<{ start: string; avg: string }>(
    `${ROLLING_CTE}
     SELECT (i - $2::int) AS start, avg
       FROM roll
      WHERE n = $2::int
        AND NOT EXISTS (
          SELECT 1 FROM unnest($3::int[]) AS c
           WHERE abs((i - $2::int) - c) < $2::int
        )
      ORDER BY avg DESC, start ASC
      LIMIT 1`,
    [activityId, seconds, chosen],
  );
  if (res.rows.length === 0) return null;
  return { start: Number(res.rows[0].start), avg: Number(res.rows[0].avg) };
}

/** Per-window max watts and HR stats, for every chosen window in one query. */
async function windowStats(
  client: PoolClient,
  activityId: string,
  seconds: number,
  starts: number[],
): Promise<Map<number, { maxWatts: number; avgHr: number | null; maxHr: number | null }>> {
  const res = await client.query<{
    start: string; max_watts: string | null; avg_hr: string | null; max_hr: string | null;
  }>(
    `SELECT st.start,
            MAX(COALESCE(t.w, 0))                                  AS max_watts,
            ROUND(AVG(t.h) FILTER (WHERE t.h > 0))                 AS avg_hr,
            MAX(t.h) FILTER (WHERE t.h > 0)                        AS max_hr
       FROM activity_streams a
       CROSS JOIN unnest($3::int[]) AS st(start)
       CROSS JOIN LATERAL (
         SELECT w.value AS w, h.value AS h
           FROM unnest(a.watts) WITH ORDINALITY AS w(value, ord)
           LEFT JOIN unnest(a.hr) WITH ORDINALITY AS h(value, ord)
             ON h.ord = w.ord
          WHERE w.ord > st.start AND w.ord <= st.start + $2::int
       ) t
      WHERE a.activity_id = $1
      GROUP BY st.start`,
    [activityId, seconds, starts],
  );

  const out = new Map<number, { maxWatts: number; avgHr: number | null; maxHr: number | null }>();
  for (const r of res.rows) {
    out.set(Number(r.start), {
      maxWatts: Number(r.max_watts ?? 0),
      avgHr: r.avg_hr == null ? null : Number(r.avg_hr),
      maxHr: r.max_hr == null ? null : Number(r.max_hr),
    });
  }
  return out;
}

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
    const selected: Window[] = [];
    for (let n = 0; n < MAX_RESULTS; n++) {
      const win = await pickWindow(client, id, seconds, selected.map(w => w.start));
      if (!win) break; // stream shorter than the window, or nothing left
      selected.push(win);
    }

    if (selected.length === 0) {
      return Response.json({ results: [], seconds });
    }

    const stats = await windowStats(client, id, seconds, selected.map(w => w.start));

    const results = selected.map(({ start, avg }, i) => {
      const s = stats.get(start);
      return {
        rank:      i + 1,
        watts:     Math.round(avg),
        max_watts: s?.maxWatts ?? 0,
        avg_hr:    s?.avgHr ?? null,
        max_hr:    s?.maxHr ?? null,
        start,
      };
    });

    return Response.json({ results, seconds });
  } finally {
    client.release();
  }
}
