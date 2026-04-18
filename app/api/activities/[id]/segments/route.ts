import pool from '@/lib/db';
import { getStravaToken, ensureSegmentTables } from '@/lib/strava-sync';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const client = await pool.connect();

  try {
    // Check if this activity has already had segments fetched
    let alreadySynced = false;
    try {
      const synced = await client.query(
        `SELECT segments_synced_at FROM activities WHERE id = $1`, [id]
      );
      alreadySynced = synced.rows[0]?.segments_synced_at != null;
    } catch {
      // Column may not exist yet — treat as not synced
      alreadySynced = false;
    }

    if (!alreadySynced) {
      // First time: fetch from Strava and store
      const token = await getStravaToken();
      const aRes  = await fetch(`https://www.strava.com/api/v3/activities/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (aRes.ok) {
        const a       = await aRes.json() as Record<string, unknown>;
        const efforts = (a.segment_efforts as Record<string, unknown>[] | null) ?? [];
        for (const se of efforts) {
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
            se.id, id, seg.id,
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
      }
      // Mark as synced so future loads are instant
      await client.query(
        `UPDATE activities SET segments_synced_at = NOW() WHERE id = $1`, [id]
      ).catch(() => {});
    }

    // Return efforts on starred segments
    const res = await client.query(`
      SELECT se.id, se.segment_id, se.name, se.elapsed_time, se.moving_time,
             se.distance, se.average_watts, se.average_heartrate,
             se.pr_rank, se.kom_rank, ss.avg_grade, ss.city
      FROM segment_efforts se
      JOIN starred_segments ss ON ss.id = se.segment_id
      WHERE se.activity_id = $1
      ORDER BY se.start_date
    `, [id]);

    return Response.json({ efforts: res.rows, hasStarred: res.rows.length > 0 });
  } catch (err) {
    console.error('[segments GET]', err);
    return Response.json({ efforts: [], hasStarred: false, error: String(err) });
  } finally {
    client.release();
  }
}

// POST — force re-sync: refresh starred segments + re-fetch this activity's efforts
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await ensureSegmentTables();
  const client = await pool.connect();

  try {
    const token = await getStravaToken();

    // 1. Re-sync starred segments from Strava
    const starredRes = await fetch(
      'https://www.strava.com/api/v3/segments/starred?per_page=200',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (starredRes.ok) {
      const segs = await starredRes.json() as Record<string, unknown>[];
      for (const s of segs) {
        const latlng = s.start_latlng as [number, number] | null;
        await client.query(`
          INSERT INTO starred_segments (id, name, distance, avg_grade, city, country, start_lat, start_lng, synced_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
          ON CONFLICT (id) DO UPDATE SET
            name=EXCLUDED.name, start_lat=EXCLUDED.start_lat, start_lng=EXCLUDED.start_lng, synced_at=NOW()
        `, [s.id, s.name, s.distance, s.average_grade, s.city, s.country,
            latlng?.[0] ?? null, latlng?.[1] ?? null]);
      }
    }

    // 2. Re-fetch this activity's segment efforts from Strava
    const aRes = await fetch(`https://www.strava.com/api/v3/activities/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!aRes.ok) throw new Error(`Strava fetch failed: ${aRes.status}`);
    const a = await aRes.json() as Record<string, unknown>;
    const efforts = (a.segment_efforts as Record<string, unknown>[] | null) ?? [];

    for (const se of efforts) {
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
        se.id, id, seg.id,
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
      `UPDATE activities SET segments_synced_at = NOW() WHERE id = $1`, [id]
    ).catch(() => {});

    // 3. Return updated matched efforts
    const res = await client.query(`
      SELECT se.id, se.segment_id, se.name, se.elapsed_time, se.moving_time,
             se.distance, se.average_watts, se.average_heartrate,
             se.pr_rank, se.kom_rank, ss.avg_grade, ss.city
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
