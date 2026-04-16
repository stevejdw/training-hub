import pool from '@/lib/db';
import { SPORT_FILTERS, CYCLING_TYPES, SportFilter } from '@/lib/sport-types';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

// Whitelist of sortable columns → SQL expression
const SORT_COLS: Record<string, string> = {
  start_date:       'start_date',
  distance:         'distance',
  moving_time:      'moving_time',
  average_watts:    'average_watts',
  average_heartrate:'average_heartrate',
  tss:              'tss',
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const filtersParam  = sp.get('filters') ?? sp.get('filter') ?? 'All';
  const from          = sp.get('from');       // ISO date
  const dateTo        = sp.get('dateTo');     // ISO date
  const minMins       = parseInt(sp.get('minMins') ?? '0', 10);
  const maxMins       = parseInt(sp.get('maxMins') ?? '0', 10);
  const timeOfDay     = sp.get('timeOfDay') ?? 'any'; // morning|afternoon|evening|any
  const sortBy        = SORT_COLS[sp.get('sortBy') ?? ''] ?? 'start_date';
  const sortDir       = sp.get('sortDir') === 'asc' ? 'ASC' : 'DESC';
  const page          = Math.max(1, parseInt(sp.get('page') ?? '1', 10));
  const limit         = 30;
  const offset        = (page - 1) * limit;

  const selectedLabels = filtersParam.split(',').map(s => s.trim()) as SportFilter[];
  const types: string[] = [];
  for (const label of selectedLabels) {
    if (label === 'All' || !SPORT_FILTERS[label]) continue;
    types.push(...SPORT_FILTERS[label]);
  }

  const client = await pool.connect();
  try {
    const conditions: string[] = [];
    const queryParams: unknown[] = [];
    let p = 1;

    // Always cycling only
    conditions.push(`sport_type = ANY($${p++}::text[])`);
    queryParams.push(types.length > 0 ? types : CYCLING_TYPES);

    // Date filters
    if (from)    { conditions.push(`(start_date AT TIME ZONE 'Australia/Sydney')::date >= $${p++}`); queryParams.push(from); }
    if (dateTo)  { conditions.push(`(start_date AT TIME ZONE 'Australia/Sydney')::date <= $${p++}`); queryParams.push(dateTo); }

    // Duration filters (in minutes → seconds)
    if (minMins > 0) { conditions.push(`moving_time >= $${p++}`); queryParams.push(minMins * 60); }
    if (maxMins > 0) { conditions.push(`moving_time <= $${p++}`); queryParams.push(maxMins * 60); }

    // Time of day (Sydney local hour)
    if (timeOfDay === 'morning')   { conditions.push(`EXTRACT(HOUR FROM start_date AT TIME ZONE 'Australia/Sydney') >= 5  AND EXTRACT(HOUR FROM start_date AT TIME ZONE 'Australia/Sydney') < 12`); }
    if (timeOfDay === 'afternoon') { conditions.push(`EXTRACT(HOUR FROM start_date AT TIME ZONE 'Australia/Sydney') >= 12 AND EXTRACT(HOUR FROM start_date AT TIME ZONE 'Australia/Sydney') < 17`); }
    if (timeOfDay === 'evening')   { conditions.push(`EXTRACT(HOUR FROM start_date AT TIME ZONE 'Australia/Sydney') >= 17`); }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const [activities, count] = await Promise.all([
      client.query(
        `SELECT id, name, sport_type, start_date, distance, moving_time,
                average_watts, normalized_power, average_heartrate, tss,
                total_elevation_gain, trainer
         FROM activities ${where}
         ORDER BY ${sortBy} ${sortDir} NULLS LAST
         LIMIT $${p++} OFFSET $${p++}`,
        [...queryParams, limit, offset]
      ),
      client.query(`SELECT COUNT(*) AS total FROM activities ${where}`, queryParams),
    ]);

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
