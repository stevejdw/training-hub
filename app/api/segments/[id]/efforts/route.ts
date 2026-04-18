import pool from '@/lib/db';
import { getStravaToken, ensureSegmentTables } from '@/lib/strava-sync';

export const runtime = 'nodejs';
export const maxDuration = 60;

function windDegToCompass(deg: number): string {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

/** Fetch wind data from Open-Meteo archive and store it for efforts missing it. */
async function backfillWind(segmentId: string): Promise<void> {
  const client = await pool.connect();
  try {
    // Get segment coordinates
    const segRes = await client.query(
      `SELECT start_lat, start_lng FROM starred_segments WHERE id = $1`, [segmentId]
    );
    const seg = segRes.rows[0];
    if (!seg?.start_lat || !seg?.start_lng) return;

    // Efforts missing wind data that are old enough for archive data (> 5 days)
    const effortsRes = await client.query(`
      SELECT id, start_date
      FROM segment_efforts
      WHERE segment_id = $1
        AND wind_speed IS NULL
        AND start_date < NOW() - INTERVAL '5 days'
      ORDER BY start_date ASC
    `, [segmentId]);

    if (effortsRes.rows.length === 0) return;

    // Single Open-Meteo call covering the full date range
    const dates = effortsRes.rows.map((r: { start_date: string }) => new Date(r.start_date));
    const minDate = dates[0];
    const maxDate = dates[dates.length - 1];
    const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

    const url = new URL('https://archive-api.open-meteo.com/v1/archive');
    url.searchParams.set('latitude',        String(seg.start_lat));
    url.searchParams.set('longitude',       String(seg.start_lng));
    url.searchParams.set('start_date',      fmtDate(minDate));
    url.searchParams.set('end_date',        fmtDate(maxDate));
    url.searchParams.set('hourly',          'wind_speed_10m,wind_direction_10m');
    url.searchParams.set('wind_speed_unit', 'kmh');
    url.searchParams.set('timezone',        'UTC');

    const weatherRes = await fetch(url.toString());
    if (!weatherRes.ok) return;

    const weather = await weatherRes.json() as {
      hourly?: {
        time: string[];
        wind_speed_10m: (number | null)[];
        wind_direction_10m: (number | null)[];
      }
    };
    if (!weather.hourly) return;

    // Build hourly lookup: "YYYY-MM-DDTHH:00" → { speed, direction }
    const windMap = new Map<string, { speed: number; direction: number }>();
    for (let i = 0; i < weather.hourly.time.length; i++) {
      const speed = weather.hourly.wind_speed_10m[i];
      const dir   = weather.hourly.wind_direction_10m[i];
      if (speed != null && dir != null) {
        windMap.set(weather.hourly.time[i], { speed, direction: dir });
      }
    }

    // Update each effort with nearest-hour wind
    for (const effort of effortsRes.rows as { id: number; start_date: string }[]) {
      const d = new Date(effort.start_date);
      // Round to nearest hour
      if (d.getUTCMinutes() >= 30) d.setUTCHours(d.getUTCHours() + 1, 0, 0, 0);
      else d.setUTCMinutes(0, 0, 0);
      const key = d.toISOString().slice(0, 13) + ':00'; // "2026-03-27T05:00"
      const wind = windMap.get(key);
      if (!wind) continue;

      await client.query(
        `UPDATE segment_efforts SET wind_speed = $1, wind_direction = $2 WHERE id = $3`,
        [Math.round(wind.speed * 10) / 10, wind.direction, effort.id]
      );
    }
  } catch (err) {
    console.error('[backfillWind]', err);
  } finally {
    client.release();
  }
}

// GET — read efforts from DB (with wind backfill), return remaining unscanned count
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Backfill wind data for any efforts missing it (fast if nothing to do)
  await backfillWind(id);

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

    // Return how many activities still need scanning so the UI can show the button
    const remaining = await client.query(
      `SELECT COUNT(*) AS n FROM activities WHERE segments_synced_at IS NULL`
    ).catch(() => ({ rows: [{ n: 0 }] }));

    return Response.json({ efforts, remaining: Number(remaining.rows[0].n) });
  } catch (err) {
    console.error('[efforts GET]', err);
    return Response.json({ efforts: [], remaining: 0, error: String(err) });
  } finally {
    client.release();
  }
}

// POST — backfill: fetch 10 unprocessed activities from Strava + update wind data
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await ensureSegmentTables();

  let processed = 0;

  // Phase 1: scan activities
  try {
    const token = await getStravaToken();
    const client = await pool.connect();
    try {
      const pending = await client.query(`
        SELECT id FROM activities
        WHERE segments_synced_at IS NULL
        ORDER BY start_date DESC
        LIMIT 10
      `);

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
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[efforts POST scan]', err);
  }

  // Phase 2: backfill wind data
  await backfillWind(id);

  // Phase 3: return updated efforts + remaining count
  const client = await pool.connect();
  try {
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
