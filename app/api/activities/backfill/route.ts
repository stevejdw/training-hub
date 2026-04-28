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
  // queries + response serialization.
  const startedAt = Date.now();
  const TIME_BUDGET_MS = 40_000;
  const timeLeft = () => TIME_BUDGET_MS - (Date.now() - startedAt);

  try {
    const token = await getStravaToken();

    // Grab 15 unscanned activities. With batch-inserted efforts the per-
    // activity cost is ~1-2s (Strava fetch) + 1 DB round-trip, so 15 at
    // concurrency 3 lands comfortably inside the 40s budget.
    const pending = await client.query(`
      SELECT id FROM activities
      WHERE segments_synced_at IS NULL
      ORDER BY start_date DESC
      LIMIT 15
    `);

    if (pending.rows.length === 0) {
      return Response.json({ processed: 0, remaining: 0 });
    }

    const ids: number[] = pending.rows.map((r: { id: number }) => r.id);
    const CONCURRENCY = 3;

    let rateLimited = false;
    let budgetExceeded = false;

    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      if (rateLimited || budgetExceeded) break;
      if (timeLeft() < 8_000) {
        budgetExceeded = true;
        console.log(`[backfill] time budget tight (${timeLeft()}ms left) after ${processed} activities`);
        break;
      }
      const batch = ids.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (activityId) => {
        // Skip starting new work if we're already out of runway
        if (timeLeft() < 3_000) { budgetExceeded = true; return; }
        try {
          const res = await fetch(
            `https://www.strava.com/api/v3/activities/${activityId}`,
            {
              headers: { Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(6000),
            }
          );

          // Rate limited — stop processing this batch and let the next cron run handle it
          if (res.status === 429) {
            rateLimited = true;
            return;
          }

          if (res.ok) {
            const a = await res.json() as Record<string, unknown>;

            // Capture gear info from the activity payload (free — already fetched)
            const gear   = a.gear as { id?: string; name?: string; nickname?: string; retired?: boolean } | null;
            const gearId = gear?.id ?? (a.gear_id as string | null) ?? null;
            if (gearId) {
              await client.query(
                `INSERT INTO gear (id, name, nickname, retired, synced_at)
                 VALUES ($1,$2,$3,$4,NOW())
                 ON CONFLICT (id) DO UPDATE SET
                   name      = COALESCE(EXCLUDED.name, gear.name),
                   nickname  = COALESCE(EXCLUDED.nickname, gear.nickname),
                   retired   = COALESCE(EXCLUDED.retired, gear.retired),
                   synced_at = NOW()`,
                [gearId, gear?.name ?? null, gear?.nickname ?? null, gear?.retired ?? null]
              ).catch(() => {});
              await client.query(
                `UPDATE activities SET gear_id = $1 WHERE id = $2 AND gear_id IS DISTINCT FROM $1`,
                [gearId, activityId]
              ).catch(() => {});
            }

            const segEfforts = (a.segment_efforts as Record<string, unknown>[] | null) ?? [];

            // Batch all efforts for this activity into a single INSERT to
            // avoid N serial round-trips to Neon. Activities with 30+ efforts
            // used to dominate the function budget here.
            const rows: unknown[][] = [];
            for (const se of segEfforts) {
              const seg = se.segment as Record<string, unknown> | null;
              if (!seg?.id) continue;
              rows.push([
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
            if (rows.length > 0) {
              const COLS = 13;
              const values: string[] = [];
              const params: unknown[] = [];
              rows.forEach((r, idx) => {
                const base = idx * COLS;
                values.push(
                  `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11},$${base+12},$${base+13})`
                );
                params.push(...r);
              });
              await client.query(
                `INSERT INTO segment_efforts
                   (id, activity_id, segment_id, name, elapsed_time, moving_time,
                    start_date, distance, average_watts, average_heartrate,
                    max_heartrate, pr_rank, kom_rank)
                 VALUES ${values.join(',')}
                 ON CONFLICT (id) DO UPDATE SET
                   segment_id    = EXCLUDED.segment_id,
                   pr_rank       = EXCLUDED.pr_rank,
                   kom_rank      = EXCLUDED.kom_rank,
                   max_heartrate = EXCLUDED.max_heartrate`,
                params
              );
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
