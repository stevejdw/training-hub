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
  const gearParam     = sp.get('gear') ?? '';
  const from          = sp.get('from');       // ISO date
  const dateTo        = sp.get('dateTo');     // ISO date
  const minMins       = parseInt(sp.get('minMins') ?? '0', 10);
  const maxMins       = parseInt(sp.get('maxMins') ?? '0', 10);
  const minKm         = parseFloat(sp.get('minKm') ?? '0');
  const maxKm         = parseFloat(sp.get('maxKm') ?? '0');
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
    conditions.push(`a.sport_type = ANY($${p++}::text[])`);
    queryParams.push(types.length > 0 ? types : CYCLING_TYPES);

    // Date filters
    if (from)    { conditions.push(`(a.start_date AT TIME ZONE 'Australia/Sydney')::date >= $${p++}`); queryParams.push(from); }
    if (dateTo)  { conditions.push(`(a.start_date AT TIME ZONE 'Australia/Sydney')::date <= $${p++}`); queryParams.push(dateTo); }

    // Duration filters (in minutes → seconds)
    if (minMins > 0) { conditions.push(`a.moving_time >= $${p++}`); queryParams.push(minMins * 60); }
    if (maxMins > 0) { conditions.push(`a.moving_time <= $${p++}`); queryParams.push(maxMins * 60); }

    // Distance filters (km → metres)
    if (minKm > 0) { conditions.push(`a.distance >= $${p++}`); queryParams.push(minKm * 1000); }
    if (maxKm > 0) { conditions.push(`a.distance <= $${p++}`); queryParams.push(maxKm * 1000); }

    // Gear filter (comma-separated list of gear ids; the special token
    // `__none__` matches activities with no gear assigned).
    const gearTokens = gearParam.split(',').map(s => s.trim()).filter(Boolean);
    if (gearTokens.length > 0) {
      const includeNone = gearTokens.includes('__none__');
      const ids = gearTokens.filter(t => t !== '__none__');
      const parts: string[] = [];
      if (ids.length > 0) {
        parts.push(`a.gear_id = ANY($${p++}::text[])`);
        queryParams.push(ids);
      }
      if (includeNone) {
        parts.push(`a.gear_id IS NULL`);
      }
      conditions.push(`(${parts.join(' OR ')})`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const [activities, count] = await Promise.all([
      client.query(
        `SELECT a.id, a.name, a.sport_type, a.start_date, a.distance, a.moving_time,
                a.average_watts, a.normalized_power, a.average_heartrate, a.tss,
                a.total_elevation_gain, a.trainer,
                a.gear_id,
                COALESCE(g.nickname, g.name) AS gear_name,
                g.power_meter
         FROM activities a
         LEFT JOIN gear g ON g.id = a.gear_id
         ${where}
         ORDER BY a.${sortBy} ${sortDir} NULLS LAST
         LIMIT $${p++} OFFSET $${p++}`,
        [...queryParams, limit, offset]
      ),
      client.query(`SELECT COUNT(*) AS total FROM activities a ${where}`, queryParams),
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
