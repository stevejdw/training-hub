import pool from '@/lib/db';
import { CYCLING_TYPES } from '@/lib/sport-types';
import { NextRequest } from 'next/server';
import { ensureBestPowerTable, warmMissingActivities } from '@/lib/best-power';

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function GET(req: NextRequest) {
  const sp      = req.nextUrl.searchParams;
  const seconds = Math.max(1, parseInt(sp.get('seconds') ?? '300', 10));
  const days    = Math.max(0, parseInt(sp.get('days')    ?? '90',  10));

  try {
    await ensureBestPowerTable();
    // Fire-and-forget warm for future requests
    warmMissingActivities(500).catch(() => {});

    const client = await pool.connect();
    try {
      // Build date clause
      let dateClause = '';
      const params: unknown[] = [seconds, CYCLING_TYPES];
      if (days > 0) {
        params.push(days);
        dateClause = `AND start_date >= NOW() - ($3::int * INTERVAL '1 day')`;
      }

      // Query best_power_efforts directly — no join needed!
      const res = await client.query(`
        SELECT
          activity_id AS id,
          start_date,
          sport_type,
          best_watts
        FROM best_power_efforts
        WHERE seconds = $1::int
          AND sport_type = ANY($2::text[])
          AND best_watts IS NOT NULL
          ${dateClause}
        ORDER BY best_watts DESC
        LIMIT 10
      `, params);

      // Attach activity name by fetching just the names for matched IDs
      let results: Record<string, unknown>[] = res.rows;
      if (res.rows.length > 0) {
        const ids = res.rows.map(r => r.id);
        const nameRes = await client.query(`
          SELECT id, name FROM activities WHERE id = ANY($1::bigint[])
        `, [ids]);
        const nameMap = new Map<number, string>();
        for (const nr of nameRes.rows) nameMap.set(nr.id as number, nr.name as string);
        results = res.rows.map(r => ({ ...r, name: nameMap.get(r.id as number) ?? `Activity ${r.id}` }));
      }

      return Response.json({ results, seconds });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Dashboard best-power error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
