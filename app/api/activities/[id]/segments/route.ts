import pool from '@/lib/db';
import { getStravaToken, ensureSegmentTables } from '@/lib/strava-sync';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await ensureSegmentTables();
  const client = await pool.connect();

  try {
    // Check if segment efforts are already stored for this activity
    const existing = await client.query(
      `SELECT COUNT(*) AS n FROM segment_efforts WHERE activity_id = $1`,
      [id]
    );

    if (Number(existing.rows[0].n) === 0) {
      // Fetch from Strava and cache
      const token  = await getStravaToken();
      const aRes   = await fetch(`https://www.strava.com/api/v3/activities/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!aRes.ok) throw new Error(`Strava fetch failed: ${aRes.status}`);
      const a      = await aRes.json() as Record<string, unknown>;
      const efforts = (a.segment_efforts as Record<string, unknown>[] | null) ?? [];

      for (const se of efforts) {
        const seg = se.segment as Record<string, unknown> | null;
        await client.query(`
          INSERT INTO segment_efforts
            (id, activity_id, segment_id, name, elapsed_time, moving_time,
             start_date, distance, average_watts, average_heartrate, max_heartrate, pr_rank, kom_rank)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          ON CONFLICT (id) DO NOTHING
        `, [
          se.id, id,
          seg?.id ?? null,
          se.name ?? seg?.name,
          se.elapsed_time, se.moving_time,
          se.start_date, se.distance,
          (se.average_watts as number | null) ?? null,
          (se.average_heartrate as number | null) ?? null,
          (se.max_heartrate as number | null) ?? null,
          (se.pr_rank as number | null) ?? null,
          (se.kom_rank as number | null) ?? null,
        ]);
      }
    }

    // Return only efforts on starred segments, joined with segment metadata
    const res = await client.query(`
      SELECT
        se.id,
        se.segment_id,
        se.name,
        se.elapsed_time,
        se.moving_time,
        se.distance,
        se.average_watts,
        se.average_heartrate,
        se.pr_rank,
        se.kom_rank,
        ss.avg_grade,
        ss.city
      FROM segment_efforts se
      JOIN starred_segments ss ON ss.id = se.segment_id
      WHERE se.activity_id = $1
      ORDER BY se.start_date
    `, [id]);

    return Response.json({ efforts: res.rows, hasStarred: res.rows.length > 0 });
  } finally {
    client.release();
  }
}
