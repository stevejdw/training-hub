import pool from '@/lib/db';
import { getProfile } from '@/lib/profile';

export const runtime = 'nodejs';

// eFTP multipliers from Coggan power-duration curve model
// Converts best power at each duration to an estimated FTP (60-min sustainable power)
const DURATIONS = [
  { key: 'd5min',  seconds: 300,  label: '5 min',  multiplier: 0.78 },
  { key: 'd10min', seconds: 600,  label: '10 min', multiplier: 0.87 },
  { key: 'd20min', seconds: 1200, label: '20 min', multiplier: 0.95 },
  { key: 'd60min', seconds: 3600, label: '60 min', multiplier: 1.00 },
];

const CYCLING_TYPES = ['Ride','VirtualRide','GravelRide','MountainBikeRide'];

export async function GET() {
  const client = await pool.connect();
  try {
    const profile = await getProfile();
    const tz = profile.timezone || 'Australia/Sydney';

    // Best power at each key duration over the last 14 days (rolling windows)
    const res = await client.query(`
      SELECT
        MAX(CASE WHEN bp.max_s300  IS NOT NULL THEN ROUND(bp.max_s300  / 300.0 )::int END) AS d5min,
        MAX(CASE WHEN bp.max_s600  IS NOT NULL THEN ROUND(bp.max_s600  / 600.0 )::int END) AS d10min,
        MAX(CASE WHEN bp.max_s1200 IS NOT NULL THEN ROUND(bp.max_s1200 / 1200.0)::int END) AS d20min,
        MAX(CASE WHEN bp.max_s3600 IS NOT NULL THEN ROUND(bp.max_s3600 / 3600.0)::int END) AS d60min
      FROM activities a
      JOIN activity_streams s ON s.activity_id = a.id
      CROSS JOIN LATERAL (
        SELECT
          MAX(CASE WHEN idx >= 300  THEN s300  END) AS max_s300,
          MAX(CASE WHEN idx >= 600  THEN s600  END) AS max_s600,
          MAX(CASE WHEN idx >= 1200 THEN s1200 END) AS max_s1200,
          MAX(CASE WHEN idx >= 3600 THEN s3600 END) AS max_s3600
        FROM (
          SELECT
            idx,
            SUM(COALESCE(w,0)::numeric) OVER (ORDER BY idx ROWS BETWEEN 299  PRECEDING AND CURRENT ROW) AS s300,
            SUM(COALESCE(w,0)::numeric) OVER (ORDER BY idx ROWS BETWEEN 599  PRECEDING AND CURRENT ROW) AS s600,
            SUM(COALESCE(w,0)::numeric) OVER (ORDER BY idx ROWS BETWEEN 1199 PRECEDING AND CURRENT ROW) AS s1200,
            SUM(COALESCE(w,0)::numeric) OVER (ORDER BY idx ROWS BETWEEN 3599 PRECEDING AND CURRENT ROW) AS s3600
          FROM unnest(s.watts) WITH ORDINALITY AS t(w, idx)
        ) sub
      ) bp
      WHERE a.sport_type = ANY($1::text[])
        AND a.start_date >= NOW() - INTERVAL '14 days'
        AND array_length(s.watts, 1) >= 300
    `, [CYCLING_TYPES]);

    const row = res.rows[0] ?? {};

    // Build per-duration estimates
    const estimates = DURATIONS
      .map(d => {
        const best = row[d.key] != null ? Number(row[d.key]) : null;
        if (!best) return null;
        return {
          duration_label: d.label,
          best_watts:     best,
          multiplier:     d.multiplier,
          eftp:           Math.round(best * d.multiplier),
        };
      })
      .filter(Boolean) as { duration_label: string; best_watts: number; multiplier: number; eftp: number }[];

    if (estimates.length === 0) {
      return Response.json({ estimates: [], best_eftp: null, best_duration: null, tz });
    }

    // Best estimate = highest eFTP across all durations
    const best = estimates.reduce((a, b) => a.eftp >= b.eftp ? a : b);

    return Response.json({
      estimates,
      best_eftp:      best.eftp,
      best_duration:  best.duration_label,
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
