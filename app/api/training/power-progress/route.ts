import pool from '@/lib/db';
import { getProfile, effectiveFtp } from '@/lib/profile';

export const runtime = 'nodejs';
export const maxDuration = 45;

const CYCLING_TYPES = ['Ride','VirtualRide','GravelRide','MountainBikeRide','EBikeRide','EMountainBikeRide'];

// Durations we always track (seconds → label)
const KEY_DURATIONS = [
  { key: 'd5min',  seconds: 300,  label: '5 min'  },
  { key: 'd10min', seconds: 600,  label: '10 min' },
  { key: 'd20min', seconds: 1200, label: '20 min' },
  { key: 'd60min', seconds: 3600, label: '60 min' },
];

export async function GET() {
  try {
    const profile = await getProfile();
    const ftp     = effectiveFtp(profile);
    const tz      = profile.timezone || 'Australia/Sydney';

    const client = await pool.connect();
    try {
      // Weekly best power at each key duration — last 26 weeks
      // Single lateral per activity computes all 4 windows in one pass
      const weeklyRes = await client.query(`
        SELECT
          date_trunc('week', (a.start_date AT TIME ZONE $1))::date::text AS week_start,
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
        WHERE a.sport_type = ANY($2::text[])
          AND a.start_date >= NOW() - INTERVAL '26 weeks'
          AND array_length(s.watts, 1) >= 300
        GROUP BY week_start
        ORDER BY week_start
      `, [tz, CYCLING_TYPES]);

      // Current bests — max over the last 90 days
      const currentRes = await client.query(`
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
        WHERE a.sport_type = ANY($2::text[])
          AND a.start_date >= NOW() - INTERVAL '90 days'
          AND array_length(s.watts, 1) >= 300
      `, [tz, CYCLING_TYPES]);

      const current = currentRes.rows[0] ?? {};

      // Build targets: prefer profile power_targets, fall back to FTP-derived
      const profileTargets = profile.power_targets ?? [];
      const targets = KEY_DURATIONS.map(d => {
        // Find a matching profile target (within ±60s of the key duration)
        const match = profileTargets.find(t => Math.abs(t.seconds - d.seconds) <= 60);
        if (match) {
          return { key: d.key, label: d.label, seconds: d.seconds, target_watts: match.target_watts, source: 'profile' as const };
        }
        // FTP-derived fallbacks (standard cycling power curve estimates)
        const ftpMultipliers: Record<string, number> = {
          d5min:  1.30,   // ~130% FTP
          d10min: 1.15,   // ~115% FTP
          d20min: 1.05,   // ~105% FTP (often used as FTP test)
          d60min: 0.95,   // ~95% FTP
        };
        return {
          key:          d.key,
          label:        d.label,
          seconds:      d.seconds,
          target_watts: Math.round(ftp * (ftpMultipliers[d.key] ?? 1.0)),
          source:       'ftp' as const,
        };
      });

      return Response.json({
        weekly:  weeklyRes.rows,
        current,
        targets,
        ftp,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Power progress error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
