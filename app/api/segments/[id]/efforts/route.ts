import pool from '@/lib/db';
import { getStravaToken, ensureSegmentTables } from '@/lib/strava-sync';
import type { PoolClient } from 'pg';

export const runtime = 'nodejs';
export const maxDuration = 60;

function windDegToCompass(deg: number): string {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

async function fetchWindForEfforts(
  lat: number,
  lng: number,
  efforts: Array<{ id: number; start_date: string; wind_speed: number | null }>
): Promise<Map<number, { speed: number; direction: number }>> {
  const cutoff  = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const missing = efforts.filter(e => e.wind_speed === null && e.start_date?.slice(0, 10) <= cutoff);
  if (missing.length === 0) return new Map();

  const dates   = missing.map(e => e.start_date.slice(0, 10));
  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));

  try {
    const url = new URL('https://archive-api.open-meteo.com/v1/archive');
    url.searchParams.set('latitude',        String(lat));
    url.searchParams.set('longitude',       String(lng));
    url.searchParams.set('start_date',      minDate);
    url.searchParams.set('end_date',        maxDate);
    url.searchParams.set('hourly',          'wind_speed_10m,wind_direction_10m');
    url.searchParams.set('wind_speed_unit', 'kmh');
    url.searchParams.set('timezone',        'UTC');

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return new Map();

    const data = await res.json() as {
      hourly: { time: string[]; wind_speed_10m: number[]; wind_direction_10m: number[] };
    };

    const result = new Map<number, { speed: number; direction: number }>();
    for (const effort of missing) {
      const effortMs = new Date(effort.start_date).getTime();
      let bestIdx = 0, bestDiff = Infinity;
      data.hourly.time.forEach((t, i) => {
        const ts   = t.length === 16 ? t + ':00Z' : t;
        const diff = Math.abs(new Date(ts).getTime() - effortMs);
        if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
      });
      const speed     = data.hourly.wind_speed_10m[bestIdx];
      const direction = data.hourly.wind_direction_10m[bestIdx];
      if (speed != null && direction != null) {
        result.set(effort.id, { speed: Math.round(speed * 10) / 10, direction });
      }
    }
    return result;
  } catch {
    return new Map();
  }
}

/** Store all segment efforts from a single Strava activity detail response */
async function storeEffortsFromActivity(
  activityId: number,
  segEfforts: Record<string, unknown>[],
  client: PoolClient
): Promise<void> {
  for (const se of segEfforts) {
    const seg = se.segment as Record<string, unknown> | null;
    if (!seg?.id) continue;
    await client.query(`
      INSERT INTO segment_efforts
        (id, activity_id, segment_id, name, elapsed_time, moving_time,
         start_date, distance, average_watts, average_heartrate, max_heartrate, pr_rank, kom_rank)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (id) DO UPDATE SET
        pr_rank       = EXCLUDED.pr_rank,
        kom_rank      = EXCLUDED.kom_rank,
        max_heartrate = EXCLUDED.max_heartrate
    `, [
      se.id, activityId, seg.id,
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
  // Mark this activity as having its segment efforts fetched
  await client.query(
    `UPDATE activities SET segments_synced_at = NOW() WHERE id = $1`,
    [activityId]
  ).catch(() => {}); // column may not exist yet; ensureSegmentTables handles it
}

/**
 * Backfill segment efforts by fetching full activity detail from Strava
 * for activities that haven't had their segment efforts stored yet.
 * Processes up to `limit` activities per call.
 */
async function backfillFromActivities(
  client: PoolClient,
  limit = 30
): Promise<{ processed: number }> {
  const token = await getStravaToken();

  // Find activities that haven't had segment efforts fetched
  const pending = await client.query(`
    SELECT id FROM activities
    WHERE segments_synced_at IS NULL
    ORDER BY start_date DESC
    LIMIT $1
  `, [limit]);

  let processed = 0;
  for (const row of pending.rows) {
    try {
      const res = await fetch(`https://www.strava.com/api/v3/activities/${row.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) continue;
      const a = await res.json() as Record<string, unknown>;
      const segEfforts = (a.segment_efforts as Record<string, unknown>[] | null) ?? [];
      await storeEffortsFromActivity(row.id, segEfforts, client);
      processed++;
    } catch {
      // skip this activity and continue
    }
  }

  return { processed };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url     = new URL(req.url);
  const force   = url.searchParams.has('force');
  const backfill = url.searchParams.has('backfill');

  await ensureSegmentTables();
  const client = await pool.connect();

  try {
    if (backfill) {
      // Fetch full Strava activity detail for unprocessed activities
      const { processed } = await backfillFromActivities(client);

      // Return updated efforts from DB
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

      // Count remaining unprocessed activities
      const remaining = await client.query(
        `SELECT COUNT(*) AS n FROM activities WHERE segments_synced_at IS NULL`
      );

      return Response.json({
        efforts: effortsRes.rows,
        processed,
        remaining: Number(remaining.rows[0].n),
      });
    }

    // Normal load: check if we have efforts in DB already
    const existingCount = await client.query(
      `SELECT COUNT(*) AS n FROM segment_efforts WHERE segment_id = $1`, [id]
    );
    const hasEfforts = Number(existingCount.rows[0].n) > 0;

    // If no efforts yet (or force), check how many activities still need processing
    const remaining = await client.query(
      `SELECT COUNT(*) AS n FROM activities WHERE segments_synced_at IS NULL`
    );
    const pendingCount = Number(remaining.rows[0].n);

    let syncInfo: string | undefined;
    if (!hasEfforts || force) {
      if (pendingCount > 0) {
        // Run a first batch automatically
        await backfillFromActivities(client, 30);
        syncInfo = pendingCount > 30
          ? `Processed 30 of ${pendingCount} activities. Click "Load more" to continue.`
          : undefined;
      }
    }

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

    // Fetch wind for efforts missing it
    const segRes = await client.query(
      `SELECT start_lat, start_lng FROM starred_segments WHERE id = $1`, [id]
    );
    const seg = segRes.rows[0];
    if (seg?.start_lat && seg?.start_lng) {
      const windMap = await fetchWindForEfforts(seg.start_lat, seg.start_lng, efforts);
      for (const effort of efforts) {
        const wind = windMap.get(effort.id);
        if (wind) {
          effort.wind_speed     = wind.speed;
          effort.wind_direction = wind.direction;
          await client.query(
            `UPDATE segment_efforts SET wind_speed=$1, wind_direction=$2 WHERE id=$3`,
            [wind.speed, wind.direction, effort.id]
          );
        }
      }
    }

    for (const e of efforts) {
      if (e.wind_direction != null) e.wind_compass = windDegToCompass(e.wind_direction);
    }

    // Re-check pending count after the backfill
    const afterPending = await client.query(
      `SELECT COUNT(*) AS n FROM activities WHERE segments_synced_at IS NULL`
    );

    return Response.json({
      efforts,
      syncInfo,
      remaining: Number(afterPending.rows[0].n),
    });
  } finally {
    client.release();
  }
}
