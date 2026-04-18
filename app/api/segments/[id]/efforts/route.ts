import pool from '@/lib/db';
import { getStravaToken, ensureSegmentTables } from '@/lib/strava-sync';

export const runtime = 'nodejs';
export const maxDuration = 60;

function windDegToCompass(deg: number): string {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

// GET — read efforts from DB only, no Strava calls
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const client = await pool.connect();

  try {
    const res = await client.query(`
      SELECT se.id, se.activity_id, se.elapsed_time,
             se.start_date, se.average_watts, se.average_heartrate, se.max_heartrate,
             se.pr_rank, se.kom_rank, se.wind_speed, se.wind_direction,
             a.name AS activity_name
      FROM segment_efforts se
      LEFT JOIN activities a ON a.id = se.activity_id
      WHERE se.segment_id = $1
      ORDER BY se.start_date DESC
    `, [id]);

    const efforts = res.rows;
    for (const e of efforts) {
      if (e.wind_direction != null) e.wind_compass = windDegToCompass(e.wind_direction);
    }

    return Response.json({ efforts });
  } catch (err) {
    console.error('[efforts GET]', err);
    return Response.json({ efforts: [], error: String(err) });
  } finally {
    client.release();
  }
}

// POST — backfill: fetch 10 unprocessed activities from Strava and extract segment efforts
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await ensureSegmentTables();
  const client = await pool.connect();

  try {
    const token = await getStravaToken();

    const pending = await client.query(`
      SELECT id FROM activities
      WHERE segments_synced_at IS NULL
      ORDER BY start_date DESC
      LIMIT 10
    `);

    let processed = 0;
    for (const row of pending.rows) {
      try {
        const res = await fetch(`https://www.strava.com/api/v3/activities/${row.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) continue;
        const a = await res.json() as Record<string, unknown>;
        const segEfforts = (a.segment_efforts as Record<string, unknown>[] | null) ?? [];

        for (const se of segEfforts) {
          const seg = se.segment as Record<string, unknown> | null;
          if (!seg?.id) continue;
          await client.query(`
            INSERT INTO segment_efforts
              (id, activity_id, segment_id, name, elapsed_time, moving_time,
               start_date, distance, average_watts, average_heartrate, max_heartrate, pr_rank, kom_rank)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            ON CONFLICT (id) DO UPDATE SET
              segment_id    = EXCLUDED.segment_id,
              pr_rank       = EXCLUDED.pr_rank,
              kom_rank      = EXCLUDED.kom_rank,
              max_heartrate = EXCLUDED.max_heartrate
          `, [
            se.id, row.id, seg.id,
            se.name ?? seg.name,
            se.elapsed_time, se.moving_time,
            se.start_date, se.distance,
            (se.average_watts     as number | null) ?? null,
            (se.average_heartrate as number | null) ?? null,
            (se.max_heartrate     as number | null) ?? null,
            (se.pr_rank           as number | null) ?? null,
            (se.kom_rank          as number | null) ?? null,
          ]);
        }

        await client.query(
          `UPDATE activities SET segments_synced_at = NOW() WHERE id = $1`, [row.id]
        );
        processed++;
      } catch { /* skip this activity */ }
    }

    // Return updated efforts for this segment
    const effortsRes = await client.query(`
      SELECT se.id, se.activity_id, se.elapsed_time,
             se.start_date, se.average_watts, se.average_heartrate, se.max_heartrate,
             se.pr_rank, se.kom_rank, se.wind_speed, se.wind_direction,
             a.name AS activity_name
      FROM segment_efforts se
      LEFT JOIN activities a ON a.id = se.activity_id
      WHERE se.segment_id = $1
      ORDER BY se.start_date DESC
    `, [id]);

    const efforts = effortsRes.rows;
    for (const e of efforts) {
      if (e.wind_direction != null) e.wind_compass = windDegToCompass(e.wind_direction);
    }

    const remaining = await client.query(
      `SELECT COUNT(*) AS n FROM activities WHERE segments_synced_at IS NULL`
    ).catch(() => ({ rows: [{ n: 0 }] }));

    return Response.json({ efforts, processed, remaining: Number(remaining.rows[0].n) });
  } catch (err) {
    console.error('[efforts POST]', err);
    return Response.json({ efforts: [], processed: 0, remaining: 0, error: String(err) });
  } finally {
    client.release();
  }
}
