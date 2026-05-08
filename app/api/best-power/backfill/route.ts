import pool from '@/lib/db';
import { computeBestPower, BEST_POWER_INTERVALS } from '@/lib/best-power';
import { CYCLING_TYPES } from '@/lib/sport-types';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/best-power/backfill
 *
 * Scans all cycling activities that have a power stream but may be missing
 * entries in `best_power_efforts`.  Computes best power for every interval
 * and upserts the results.
 *
 * Query params:
 *   ?limit=500    — stop after this many activities (default 500)
 *   ?offset=0     — skip this many rows (for paginated retries)
 */
export async function POST(req: Request) {
  const sp      = new URL(req.url).searchParams;
  const limit   = Math.min(1000, Math.max(1, parseInt(sp.get('limit') ?? '500', 10)));
  const offset  = Math.max(0, parseInt(sp.get('offset') ?? '0', 10));

  const client = await pool.connect();
  try {
    // Ensure the table exists first
    await client.query(`
      CREATE TABLE IF NOT EXISTS best_power_efforts (
        activity_id  BIGINT NOT NULL,
        seconds      INT NOT NULL,
        best_watts   NUMERIC(10,1),
        PRIMARY KEY (activity_id, seconds)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_best_power_seconds ON best_power_efforts(seconds, best_watts DESC)
    `);

    // Find activities with power streams that are missing from best_power_efforts
    const missingRes = await client.query(`
      SELECT a.id
      FROM activities a
      JOIN activity_streams s ON s.activity_id = a.id
      WHERE a.sport_type = ANY($1::text[])
        AND array_length(s.watts, 1) > 0
        AND NOT EXISTS (
          SELECT 1 FROM best_power_efforts bpe
          WHERE bpe.activity_id = a.id
        )
      ORDER BY a.start_date DESC
      LIMIT $2 OFFSET $3
    `, [CYCLING_TYPES, limit, offset]);

    const ids = missingRes.rows.map(r => r.id as number);
    if (ids.length === 0) {
      return Response.json({ synced: 0, total: 0, done: true, message: 'All activities already synced' });
    }

    // Fetch all streams for these activities in one query
    const streamsRes = await client.query(`
      SELECT activity_id, watts FROM activity_streams
      WHERE activity_id = ANY($1::bigint[])
    `, [ids]);

    const streamMap = new Map<number, (number | null)[]>();
    for (const row of streamsRes.rows) {
      streamMap.set(row.activity_id as number, row.watts as (number | null)[]);
    }

    // Compute and store best power for each activity
    let synced = 0;
    for (const id of ids) {
      const watts = streamMap.get(id);
      if (!watts || watts.length === 0) continue;

      const results = computeBestPower(watts);

      // Batch-upsert into best_power_efforts
      const valueClauses: string[] = [];
      const valueParams: unknown[] = [];
      for (const r of results) {
        if (r.best_watts != null) {
          valueClauses.push(`($${valueParams.length + 1}, $${valueParams.length + 2}, $${valueParams.length + 3})`);
          valueParams.push(id, r.seconds, r.best_watts);
        }
      }
      if (valueClauses.length > 0) {
        await client.query(`
          INSERT INTO best_power_efforts (activity_id, seconds, best_watts)
          VALUES ${valueClauses.join(', ')}
          ON CONFLICT (activity_id, seconds) DO UPDATE SET best_watts = EXCLUDED.best_watts
        `, valueParams);
      }
      synced++;
    }

    return Response.json({
      synced,
      total: ids.length,
      done: ids.length < limit,
      nextOffset: offset + ids.length,
    });
  } catch (err) {
    console.error('Best power backfill error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
