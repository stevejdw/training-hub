import pool from '@/lib/db';
import { SPORT_FILTERS, SportFilter } from '@/lib/sport-types';
import { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  // Support multiple filters: ?filters=Ride,Walk or legacy ?filter=Ride
  const filtersParam = req.nextUrl.searchParams.get('filters') ?? req.nextUrl.searchParams.get('filter') ?? 'All';
  const page = parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10);
  const limit = 30;
  const offset = (page - 1) * limit;

  // Build combined sport_types from all selected filter labels
  const selectedLabels = filtersParam.split(',').map(s => s.trim()) as SportFilter[];
  const types: string[] = [];
  for (const label of selectedLabels) {
    if (label === 'All' || !SPORT_FILTERS[label]) continue;
    types.push(...SPORT_FILTERS[label]);
  }

  const client = await pool.connect();
  try {
    let activities, count;

    if (types.length > 0) {
      activities = await client.query(
        `SELECT id, name, sport_type, start_date, distance, moving_time,
                average_watts, normalized_power, average_heartrate, tss,
                total_elevation_gain, trainer
         FROM activities
         WHERE sport_type = ANY($1::text[])
         ORDER BY start_date DESC
         LIMIT $2 OFFSET $3`,
        [types, limit, offset]
      );
      count = await client.query(
        `SELECT COUNT(*) AS total FROM activities WHERE sport_type = ANY($1::text[])`,
        [types]
      );
    } else {
      activities = await client.query(
        `SELECT id, name, sport_type, start_date, distance, moving_time,
                average_watts, normalized_power, average_heartrate, tss,
                total_elevation_gain, trainer
         FROM activities
         ORDER BY start_date DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      count = await client.query(`SELECT COUNT(*) AS total FROM activities`);
    }

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
