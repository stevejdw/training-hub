import pool from '@/lib/db';
import { SPORT_FILTERS, CYCLING_TYPES, SportFilter } from '@/lib/sport-types';
import { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const filtersParam = req.nextUrl.searchParams.get('filters') ?? req.nextUrl.searchParams.get('filter') ?? 'All';
  const from = req.nextUrl.searchParams.get('from'); // ISO date e.g. 2026-04-14
  const page = parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10);
  const limit = 30;
  const offset = (page - 1) * limit;

  const selectedLabels = filtersParam.split(',').map(s => s.trim()) as SportFilter[];
  const types: string[] = [];
  for (const label of selectedLabels) {
    if (label === 'All' || !SPORT_FILTERS[label]) continue;
    types.push(...SPORT_FILTERS[label]);
  }

  const client = await pool.connect();
  try {
    let activities, count;
    const hasTypes = types.length > 0;
    const hasFrom = !!from;

    // Build WHERE conditions — always restrict to cycling types
    const conditions: string[] = [];
    const queryParams: (string | number | string[])[] = [];
    let p = 1;

    const activeSportTypes = hasTypes ? types : CYCLING_TYPES;
    conditions.push(`sport_type = ANY($${p++}::text[])`);
    queryParams.push(activeSportTypes);
    if (hasFrom) { conditions.push(`start_date >= $${p++}`); queryParams.push(from); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    activities = await client.query(
      `SELECT id, name, sport_type, start_date, distance, moving_time,
              average_watts, normalized_power, average_heartrate, tss,
              total_elevation_gain, trainer
       FROM activities ${where}
       ORDER BY start_date DESC
       LIMIT $${p++} OFFSET $${p++}`,
      [...queryParams, limit, offset]
    );
    count = await client.query(
      `SELECT COUNT(*) AS total FROM activities ${where}`,
      queryParams
    );

    return Response.json({
      activities: activities.rows,
      total: Number(count.rows[0].total),
      page,
      pages: Math.ceil(Number(count.rows[0].total) / limit),
    });
  } catch (err) {
    console.error('Activities API error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
