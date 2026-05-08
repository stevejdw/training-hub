import pool from '@/lib/db';
import { getProfile } from '@/lib/profile';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

const CYCLING = ['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide'];

/**
 * Aerobic efficiency / decoupling per ride.
 *
 * Filters to "steady" rides (Variability Index < 1.05) so that EF is
 * meaningful — VI compares NP to avg power; ≈1.0 means a flat-line effort.
 *
 * Decoupling % = ((EF_h1 − EF_h2) / EF_h1) × 100
 * where EF = avg_watts / avg_hr for each half of the ride. >5% indicates
 * meaningful aerobic decoupling (cardiac drift), often a marker of fatigue
 * or insufficient base aerobic fitness.
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

    const sql = `
      SELECT
        a.id,
        a.start_date::date::text     AS date,
        a.name,
        a.average_watts,
        a.normalized_power,
        a.average_heartrate,
        a.moving_time,
        a.summary_polyline,
        s.watts,
        s.hr
      FROM activities a
      JOIN activity_streams s ON s.activity_id = a.id
      WHERE a.sport_type = ANY($1::text[])
        AND a.normalized_power IS NOT NULL
        AND a.average_watts    > 0
        AND a.average_heartrate > 60
        AND (a.normalized_power::float / a.average_watts) < 1.10
        AND s.watts IS NOT NULL
        AND s.hr    IS NOT NULL
        AND array_length(s.watts, 1) > 60
        AND array_length(s.hr, 1)    > 60
        ${interval ? `AND a.start_date >= NOW() - INTERVAL '${interval}'` : ''}
      ORDER BY a.start_date ASC
      LIMIT 500
    `;

    const res = await client.query(sql, [CYCLING]);

    const rides = res.rows.map(r => {
      const watts = (r.watts ?? []) as (number | null)[];
      const hr    = (r.hr    ?? []) as (number | null)[];
      const n     = Math.min(watts.length, hr.length);
      const half  = Math.floor(n / 2);

      function avgs(start: number, end: number) {
        let pw = 0, h = 0, c = 0;
        for (let i = start; i < end; i++) {
          const wv = watts[i];
          const hv = hr[i];
          if (hv != null && hv > 30 && wv != null) {
            pw += wv;
            h  += hv;
            c++;
          }
        }
        return c > 0 ? { pw: pw / c, hr: h / c } : { pw: 0, hr: 0 };
      }

      const a1 = avgs(0, half);
      const a2 = avgs(half, n);
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
