import pool from '@/lib/db';
import { getStravaToken } from '@/lib/strava-sync';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET  — returns { remaining } count of activities missing time_s
 * POST — fetches time stream from Strava for up to 15 activities per call
 *        returns { processed, remaining }
 */

function downsampleArr<T>(arr: T[], maxPts: number): T[] {
  if (arr.length <= maxPts) return arr;
  const step = arr.length / maxPts;
  return Array.from({ length: maxPts }, (_, i) => arr[Math.round(i * step)]);
}

const STREAM_MAX_POINTS = 5000;

export async function GET() {
  const client = await pool.connect();
  try {
    await client.query(
      `ALTER TABLE activity_streams ADD COLUMN IF NOT EXISTS time_s INT[]`
    ).catch(() => {});
    const res = await client.query(
      `SELECT COUNT(*) AS n FROM activity_streams
       WHERE distance_km IS NOT NULL AND array_length(distance_km, 1) > 0
         AND (time_s IS NULL OR array_length(time_s, 1) IS NULL)`
    );
    return Response.json({ remaining: Number(res.rows[0].n) });
  } catch (err) {
    return Response.json({ remaining: 0, error: String(err) });
  } finally {
    client.release();
  }
}

export async function POST() {
  const client = await pool.connect();
  let processed = 0;
  let remaining = 0;
  const startedAt = Date.now();
  const TIME_BUDGET_MS = 40_000;
  const timeLeft = () => TIME_BUDGET_MS - (Date.now() - startedAt);

  try {
    await client.query(
      `ALTER TABLE activity_streams ADD COLUMN IF NOT EXISTS time_s INT[]`
    ).catch(() => {});

    const token = await getStravaToken();

    const pending = await client.query<{ activity_id: number }>(
      `SELECT activity_id FROM activity_streams
       WHERE distance_km IS NOT NULL AND array_length(distance_km, 1) > 0
         AND (time_s IS NULL OR array_length(time_s, 1) IS NULL)
       ORDER BY activity_id DESC
       LIMIT 15`
    );

    if (pending.rows.length === 0) {
      return Response.json({ processed: 0, remaining: 0 });
    }

    const ids = pending.rows.map(r => r.activity_id);
    const CONCURRENCY = 3;
    let rateLimited = false;

    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      if (rateLimited || timeLeft() < 8_000) break;
      const batch = ids.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (activityId) => {
        if (timeLeft() < 3_000) return;
        try {
          const res = await fetch(
            `https://www.strava.com/api/v3/activities/${activityId}/streams?keys=time&key_by_type=true`,
            { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) }
          );
          if (res.status === 429) { rateLimited = true; return; }
          if (!res.ok) {
            // Mark with empty array so we don't retry indefinitely
            await client.query(
              `UPDATE activity_streams SET time_s = '{}' WHERE activity_id = $1`,
              [activityId]
            ).catch(() => {});
            return;
          }
          const data = await res.json() as Record<string, unknown>;
          const timeRaw = (data?.time as { data: number[] } | null)?.data ?? null;
          if (!timeRaw?.length) {
            await client.query(
              `UPDATE activity_streams SET time_s = '{}' WHERE activity_id = $1`,
              [activityId]
            ).catch(() => {});
            return;
          }
          const timeStream = downsampleArr(timeRaw, STREAM_MAX_POINTS).map(t => Math.round(t));
          await client.query(
            `UPDATE activity_streams SET time_s = $1 WHERE activity_id = $2`,
            [timeStream, activityId]
          );
          processed++;
        } catch {
          // leave time_s null so it stays in the retry queue
        }
      }));
    }

    const remRes = await client.query(
      `SELECT COUNT(*) AS n FROM activity_streams
       WHERE distance_km IS NOT NULL AND array_length(distance_km, 1) > 0
         AND (time_s IS NULL OR array_length(time_s, 1) IS NULL)`
    );
    remaining = Number(remRes.rows[0].n);

    return Response.json({ processed, remaining, rateLimited });
  } catch (err) {
    console.error('[backfill/streams]', err);
    return Response.json({ processed, remaining, error: String(err) });
  } finally {
    client.release();
  }
}
