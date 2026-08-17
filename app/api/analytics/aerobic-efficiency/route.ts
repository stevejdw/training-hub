import pool from '@/lib/db';
import { getProfile } from '@/lib/profile';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
// Averaging both halves of every qualifying ride costs ~500ms per ride because
// the stored 1 Hz arrays run to tens of thousands of samples on long rides.
// That was fine while only a few hundred rides had normalized_power; the Garmin
// backfill made ~2,200 eligible, and 6-month and longer ranges started
// exceeding 30s and returning nothing. Raised so the chart works today — the
// real fix is to precompute the half-ride averages once per activity rather
// than on every chart load (see the note on the query below).
export const maxDuration = 120;

const CYCLING = ['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide'];

/**
 * Aerobic efficiency / decoupling per ride.
 *
 * Filters to "steady" rides (Variability Index < 1.10) so that EF is
 * meaningful — VI compares NP to avg power; ≈1.0 means a flat-line effort.
 *
 * Decoupling % = ((EF_h1 − EF_h2) / EF_h1) × 100
 * where EF = avg_watts / avg_hr for each half of the ride. >5% indicates
 * meaningful aerobic decoupling (cardiac drift), often a marker of fatigue
 * or insufficient base aerobic fitness.
 *
 * Rides shorter than 60 minutes are excluded to ensure meaningful decoupling data.
 * Rides can be individually excluded by adding their ID to the excluded_rides array
 * in the athlete_profile.
 */
export async function GET(req: NextRequest) {
  const range = req.nextUrl.searchParams.get('range') ?? '90d';

  let interval: string | null;
  switch (range) {
    case '1m':   interval = '1 month';   break;
    case '3m':   interval = '3 months';  break;
    case '6m':   interval = '6 months';  break;
    case '90d':  interval = '90 days';   break;
    case '180d': interval = '180 days';  break;
    case '365d': interval = '365 days';  break;
    case 'all':  interval = null;        break;
    default:     interval = '3 months';
  }

  const [profile, client] = await Promise.all([getProfile(), pool.connect()]);
  try {
    // Derive power zone boundaries (5-zone model: z1_max, z2_max, z3_max, z4_max)
    let zoneBoundaries: number[] | null = profile.power_zone_boundaries ?? null;
    if (!zoneBoundaries && profile.ftp) {
      const ftp = profile.ftp;
      zoneBoundaries = [
        Math.round(ftp * 0.55),
        Math.round(ftp * 0.75),
        Math.round(ftp * 0.90),
        Math.round(ftp * 1.05),
      ];
    }

    // HRV baseline: 60-day rolling avg ± 1σ for low-HRV flagging
    const wRes = await client.query<{ date: string; hrv_rmssd: number | null }>(`
      SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date, hrv_rmssd
      FROM daily_wellness
      WHERE date >= CURRENT_DATE - INTERVAL '60 days'
        AND hrv_rmssd IS NOT NULL
      ORDER BY date ASC
    `);
    const hrvValues = wRes.rows.map(r => r.hrv_rmssd!).filter(v => v > 0);
    let hrvLowerBound: number | null = null;
    if (hrvValues.length >= 7) {
      const avg = hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length;
      const sd  = Math.sqrt(hrvValues.reduce((a, b) => a + (b - avg) ** 2, 0) / hrvValues.length);
      hrvLowerBound = avg - sd;
    }
    const hrvByDate = new Map(wRes.rows.map(r => [r.date, r.hrv_rmssd]));

    // Get excluded ride IDs from profile
    const excludedRides: number[] = (profile as any).excluded_rides ?? [];

    const params: unknown[] = [CYCLING];
    let paramIdx = 2;

    let excludeClause = '';
    if (excludedRides.length > 0) {
      excludeClause = `AND a.id <> ALL($${paramIdx}::bigint[])`;
      params.push(excludedRides);
      paramIdx++;
    }

    // Half-ride power/HR averages are computed inside Postgres so only a few
    // scalar columns per ride cross the wire — never the raw watts/hr arrays
    // (which cost ~100-200KB of egress per ride).
    // Select the qualifying rides FIRST, then unnest streams for only those.
    //
    // Previously the stream join and the two LATERALs sat in the same query as
    // the activity filters, so the planner averaged 1 Hz watts/hr arrays for
    // every cycling ride before discarding most of them. That was survivable
    // while few rides had normalized_power; once the Garmin backfill populated
    // it on ~2,200 rides the query went to ~24s at 90 days and ~46s at 6
    // months — past the 30s maxDuration, which is why the longer ranges
    // returned nothing at all.
    //
    // MATERIALIZED forces the candidate set to be built before any array work,
    // so the expensive part runs on tens of rides rather than thousands.
    const sql = `
      WITH candidates AS MATERIALIZED (
        SELECT
          a.id,
          a.start_date,
          a.start_date::date::text AS date,
          a.name,
          a.average_watts,
          a.normalized_power,
          a.average_heartrate,
          a.moving_time,
          a.summary_polyline
        FROM activities a
        WHERE a.sport_type = ANY($1::text[])
          AND a.normalized_power IS NOT NULL
          AND a.average_watts    > 0
          AND a.average_heartrate > 60
          AND (a.normalized_power::float / a.average_watts) < 1.10
          AND a.moving_time >= 3600  -- exclude rides shorter than 60 minutes
          ${interval ? `AND a.start_date >= NOW() - INTERVAL '${interval}'` : ''}
          ${excludeClause}
        ORDER BY a.start_date ASC
        LIMIT 500
      )
      SELECT
        c.id, c.date, c.name, c.average_watts, c.normalized_power,
        c.average_heartrate, c.moving_time, c.summary_polyline,
        halves.pw1, halves.hr1, halves.pw2, halves.hr2
      FROM candidates c
      JOIN activity_streams s ON s.activity_id = c.id
      CROSS JOIN LATERAL (
        SELECT LEAST(array_length(s.watts, 1), array_length(s.hr, 1)) AS n
      ) dims
      CROSS JOIN LATERAL (
        SELECT
          COALESCE(AVG(t.wv) FILTER (WHERE t.ord <= dims.n / 2), 0) AS pw1,
          COALESCE(AVG(t.hv) FILTER (WHERE t.ord <= dims.n / 2), 0) AS hr1,
          COALESCE(AVG(t.wv) FILTER (WHERE t.ord >  dims.n / 2 AND t.ord <= dims.n), 0) AS pw2,
          COALESCE(AVG(t.hv) FILTER (WHERE t.ord >  dims.n / 2 AND t.ord <= dims.n), 0) AS hr2
        FROM unnest(s.watts, s.hr) WITH ORDINALITY AS t(wv, hv, ord)
        WHERE t.wv IS NOT NULL AND t.hv IS NOT NULL AND t.hv > 30
      ) halves
      WHERE s.watts IS NOT NULL
        AND s.hr    IS NOT NULL
        AND array_length(s.watts, 1) > 60
        AND array_length(s.hr, 1)    > 60
      ORDER BY c.start_date ASC
    `;

    const res = await client.query(sql, params);


    const rides = res.rows.map(r => {
      const a1 = { pw: Number(r.pw1), hr: Number(r.hr1) };
      const a2 = { pw: Number(r.pw2), hr: Number(r.hr2) };
      const ef1 = a1.hr > 0 ? a1.pw / a1.hr : 0;
      const ef2 = a2.hr > 0 ? a2.pw / a2.hr : 0;
      const decoupling = ef1 > 0 ? ((ef1 - ef2) / ef1) * 100 : 0;

      const rideHrv = hrvByDate.get(r.date) ?? null;
      const hrv_low = rideHrv !== null && hrvLowerBound !== null ? rideHrv < hrvLowerBound : null;

      return {
        id:           r.id,
        date:         r.date,
        name:         r.name,
        summary_polyline: r.summary_polyline ?? null,
        np:           Math.round(Number(r.normalized_power)),
        avg_watts:    Math.round(Number(r.average_watts)),
        avg_hr:       Math.round(Number(r.average_heartrate)),
        moving_time:  Number(r.moving_time) || 0,
        vi:           Math.round((Number(r.normalized_power) / Number(r.average_watts)) * 1000) / 1000,
        ef_h1:        Math.round(ef1 * 100) / 100,
        ef_h2:        Math.round(ef2 * 100) / 100,
        pw_h1:        Math.round(a1.pw),
        pw_h2:        Math.round(a2.pw),
        hr_h1:        Math.round(a1.hr),
        hr_h2:        Math.round(a2.hr),
        decoupling:   Math.round(decoupling * 10) / 10,
        hrv_low,
      };
    });

    return Response.json({ rides, range, zone_boundaries: zoneBoundaries });
  } catch (err) {
    console.error('[aerobic-efficiency]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
