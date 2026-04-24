import pool from '@/lib/db';
import { getStravaToken } from '@/lib/strava-sync';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/activities/backfill
 *
 * Fetches segment efforts from Strava for up to 20 activities that haven't
 * been scanned yet, processing them in parallel (2 at a time).
 * Returns { processed, remaining } so the caller can loop until done.
 *
 * GET /api/activities/backfill
 * Returns { remaining } count so the UI can show progress.
 */

export async function GET() {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT COUNT(*) AS n FROM activities WHERE segments_synced_at IS NULL`
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

  // Hard wall-clock budget — Vercel caps at 60s, leave headroom for final
  // queries + response serialization. Stop starting new batches past 45s.
  const startedAt = Date.now();
  const TIME_BUDGET_MS = 45_000;

  try {
    const token = await getStravaToken();

    // Grab 10 unscanned activities. At concurrency 3 that's ~4 batches, each
    // dominated by Strava's per-request latency (~1-3s) + N segment-effort
    // DB writes. Activities with many efforts can balloon past 5s, so we
    // cap the batch to stay safely inside the 60s function budget.
    const pending = await client.query(`
      SELECT id FROM activities
      WHERE segments_synced_at IS NULL
      ORDER BY start_date DESC
      LIMIT 10
    `);

    if (pending.rows.length === 0) {
      return Response.json({ processed: 0, remaining: 0 });
    }

    const ids: number[] = pending.rows.map((r: { id: number }) => r.id);
    const CONCURRENCY = 3;

    let rateLimited = false;

    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      if (rateLimited) break;
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        console.log(`[backfill] time budget reached after ${processed} activities — deferring rest to next run`);
        break;
      }
      const batch = ids.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (activityId) => {
        try {
          const res = await fetch(
            `https://www.strava.com/api/v3/activities/${activityId}`,
            {
              headers: { Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(8000),
            }
          );

          // Rate limited — stop processing this batch and let the next cron run handle it
          if (res.status === 429) {
            rateLimited = true;
            return;
          }

          if (res.ok) {
            const a = await res.json() as Record<string, unknown>;
            const segEfforts = (a.segment_efforts as Record<string, unknown>[] | null) ?? [];
            for (const se of segEfforts) {
              const seg = se.segment as Record<string, unknown> | null;
              if (!seg?.id) continue;
              await client.query(`
                INSERT INTO segment_efforts
                  (id, activity_id, segment_id, name, elapsed_time, moving_time,
                   start_date, distance, average_watts, average_heartrate,
                   max_heartrate, pr_rank, kom_rank)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                ON CONFLICT (id) DO UPDATE SET
                  segment_id    = EXCLUDED.segment_id,
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
          }

          await client.query(
            `UPDATE activities SET segments_synced_at = NOW() WHERE id = $1`,
            [activityId]
          );
          processed++;
        } catch {
          // Mark as synced anyway to avoid retrying indefinitely
          await client.query(
            `UPDATE activities SET segments_synced_at = NOW() WHERE id = $1`,
            [activityId]
          ).catch(() => {});
        }
      }));
    }

    // Repair any null segment_ids by name-match while we're here
    await client.query(`
      UPDATE segment_efforts se
      SET segment_id = ss.id
      FROM starred_segments ss
      WHERE se.segment_id IS NULL AND se.name = ss.name
    `).catch(() => {});

    const remRes = await client.query(
      `SELECT COUNT(*) AS n FROM activities WHERE segments_synced_at IS NULL`
    );
    remaining = Number(remRes.rows[0].n);

    return Response.json({ processed, remaining, rateLimited });
  } catch (err) {
    console.error('[backfill POST]', err);
    // Always return 200 so the cron workflow doesn't fail — the error is logged above
    return Response.json({ processed, remaining, error: String(err) });
  } finally {
    client.release();
  }
}
