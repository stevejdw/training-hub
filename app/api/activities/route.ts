import pool from '@/lib/db';
import { SPORT_FILTERS, SportFilter } from '@/lib/sport-types';
import { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const filter = (req.nextUrl.searchParams.get('filter') ?? 'All') as SportFilter;
  const page = parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10);
  const limit = 30;
  const offset = (page - 1) * limit;

  const typesRaw = SPORT_FILTERS[filter] ?? [];
  const types: string[] = [...typesRaw];
  const typeClause = types.length > 0 ? `AND sport_type = ANY($3::text[])` : '';
  const params: (number | string[])[] = [limit, offset];
  if (types.length > 0) params.push(types);

  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT
        id,
        name,
        sport_type,
        start_date,
        distance,
        moving_time,
        average_watts,
        normalized_power,
        average_heartrate,
        tss,
        total_elevation_gain,
        trainer
      FROM activities
      WHERE 1=1 ${typeClause}
      ORDER BY start_date DESC
      LIMIT $1 OFFSET $2
    `, params);

    const countParams: string[][] = [];
    if (types.length > 0) countParams.push(types);
    const count = await client.query(
      `SELECT COUNT(*) AS total FROM activities WHERE 1=1 ${typeClause}`,
      countParams
    );

    return Response.json({
      activities: result.rows,
      total: Number(count.rows[0].total),
      page,
      pages: Math.ceil(Number(count.rows[0].total) / limit),
    });
  } finally {
    client.release();
  }
}
