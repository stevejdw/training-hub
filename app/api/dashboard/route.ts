import pool from '@/lib/db';
import { SPORT_FILTERS, SportFilter } from '@/lib/sport-types';
import { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const filtersParam = req.nextUrl.searchParams.get('filters') ?? 'All';
  const selectedLabels = filtersParam.split(',').map(s => s.trim()) as SportFilter[];
  const types: string[] = [];
  for (const label of selectedLabels) {
    if (label === 'All' || !SPORT_FILTERS[label]) continue;
    types.push(...SPORT_FILTERS[label]);
  }

  const client = await pool.connect();
  try {
    let wtd, mtd, ytd;

    if (types.length > 0) {
      wtd = await client.query(`
        SELECT COUNT(*) AS activities,
          ROUND(SUM(distance)::numeric / 1000.0, 1) AS km,
          ROUND(SUM(moving_time)::numeric / 3600.0, 1) AS hours,
          ROUND(SUM(COALESCE(tss, hrss, 0))::numeric, 0) AS tss
        FROM activities
        WHERE date_trunc('week', start_date AT TIME ZONE 'Australia/Sydney')
            = date_trunc('week', NOW() AT TIME ZONE 'Australia/Sydney')
          AND sport_type = ANY($1::text[])
      `, [types]);

      mtd = await client.query(`
        SELECT COUNT(*) AS activities,
          ROUND(SUM(distance)::numeric / 1000.0, 1) AS km,
          ROUND(SUM(moving_time)::numeric / 3600.0, 1) AS hours,
          ROUND(SUM(COALESCE(tss, hrss, 0))::numeric, 0) AS tss
        FROM activities
        WHERE date_trunc('month', start_date AT TIME ZONE 'Australia/Sydney')
            = date_trunc('month', NOW() AT TIME ZONE 'Australia/Sydney')
          AND sport_type = ANY($1::text[])
      `, [types]);

      ytd = await client.query(`
        SELECT COUNT(*) AS activities,
          ROUND(SUM(distance)::numeric / 1000.0, 1) AS km,
          ROUND(SUM(moving_time)::numeric / 3600.0, 1) AS hours,
          ROUND(SUM(COALESCE(tss, hrss, 0))::numeric, 0) AS tss,
          ROUND(SUM(total_elevation_gain)::numeric, 0) AS elevation
        FROM activities
        WHERE EXTRACT(YEAR FROM start_date AT TIME ZONE 'Australia/Sydney')
            = EXTRACT(YEAR FROM NOW() AT TIME ZONE 'Australia/Sydney')
          AND sport_type = ANY($1::text[])
      `, [types]);
    } else {
      wtd = await client.query(`
        SELECT COUNT(*) AS activities,
          ROUND(SUM(distance)::numeric / 1000.0, 1) AS km,
          ROUND(SUM(moving_time)::numeric / 3600.0, 1) AS hours,
          ROUND(SUM(COALESCE(tss, hrss, 0))::numeric, 0) AS tss
        FROM activities
        WHERE date_trunc('week', start_date AT TIME ZONE 'Australia/Sydney')
            = date_trunc('week', NOW() AT TIME ZONE 'Australia/Sydney')
      `);

      mtd = await client.query(`
        SELECT COUNT(*) AS activities,
          ROUND(SUM(distance)::numeric / 1000.0, 1) AS km,
          ROUND(SUM(moving_time)::numeric / 3600.0, 1) AS hours,
          ROUND(SUM(COALESCE(tss, hrss, 0))::numeric, 0) AS tss
        FROM activities
        WHERE date_trunc('month', start_date AT TIME ZONE 'Australia/Sydney')
            = date_trunc('month', NOW() AT TIME ZONE 'Australia/Sydney')
      `);

      ytd = await client.query(`
        SELECT COUNT(*) AS activities,
          ROUND(SUM(distance)::numeric / 1000.0, 1) AS km,
          ROUND(SUM(moving_time)::numeric / 3600.0, 1) AS hours,
          ROUND(SUM(COALESCE(tss, hrss, 0))::numeric, 0) AS tss,
          ROUND(SUM(total_elevation_gain)::numeric, 0) AS elevation
        FROM activities
        WHERE EXTRACT(YEAR FROM start_date AT TIME ZONE 'Australia/Sydney')
            = EXTRACT(YEAR FROM NOW() AT TIME ZONE 'Australia/Sydney')
      `);
    }

    return Response.json({ mtd: mtd.rows[0], wtd: wtd.rows[0], ytd: ytd.rows[0] });
  } catch (err) {
    console.error('Dashboard API error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
