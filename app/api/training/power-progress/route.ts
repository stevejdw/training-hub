import pool from '@/lib/db';
import { getProfile, effectiveFtp } from '@/lib/profile';

export const runtime = 'nodejs';
export const maxDuration = 45;

const CYCLING_TYPES = ['Ride','VirtualRide','GravelRide','MountainBikeRide','EBikeRide','EMountainBikeRide'];

const DEFAULTS = [
  { seconds: 180,  label: '3 min'  },
  { seconds: 300,  label: '5 min'  },
  { seconds: 600,  label: '10 min' },
  { seconds: 1200, label: '20 min' },
  { seconds: 1800, label: '30 min' },
];

// Default FTP multipliers for fallback target watts
const FTP_MULTIPLIERS: Record<number, number> = {
  180:  1.40,
  300:  1.30,
  600:  1.15,
  1200: 1.05,
  1800: 1.00,
};

// Chart colours — assigned by position
const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#60a5fa', '#a78bfa', '#f472b6'];

export async function GET() {
  try {
    const profile = await getProfile();
    const ftp     = effectiveFtp(profile);
    const tz      = profile.timezone || 'Australia/Sydney';

    // Build duration list from profile targets; pad with defaults to 5 if needed
    const profileTargets = profile.power_targets ?? [];

    // Use profile durations (sorted), then fill up to 5 from defaults
    let durations = profileTargets
      .slice()
      .sort((a, b) => a.seconds - b.seconds)
      .map(t => ({ seconds: t.seconds, label: t.label }));

    if (durations.length < 5) {
      const existing = new Set(durations.map(d => d.seconds));
      for (const def of DEFAULTS) {
        if (!existing.has(def.seconds)) {
          durations.push(def);
          if (durations.length === 5) break;
        }
      }
      durations.sort((a, b) => a.seconds - b.seconds);
    }

    // Ensure seconds are positive integers (safety)
    durations = durations.filter(d => Number.isInteger(d.seconds) && d.seconds > 0);

    const minSeconds = Math.min(...durations.map(d => d.seconds));

    // Build dynamic SQL fragments
    const windowExprs = durations
      .map(d => `SUM(COALESCE(w,0)::numeric) OVER (ORDER BY idx ROWS BETWEEN ${d.seconds - 1} PRECEDING AND CURRENT ROW) AS ws${d.seconds}`)
      .join(',\n              ');

    const lateralExprs = durations
      .map(d => `MAX(CASE WHEN idx >= ${d.seconds} THEN ws${d.seconds} END) AS max_ws${d.seconds}`)
      .join(',\n            ');

    const selectExprs = durations
      .map(d => `MAX(CASE WHEN bp.max_ws${d.seconds} IS NOT NULL THEN ROUND(bp.max_ws${d.seconds} / ${d.seconds}.0)::int END) AS d_${d.seconds}`)
      .join(',\n          ');

    const client = await pool.connect();
    try {
      const weeklyRes = await client.query(`
        SELECT
          date_trunc('week', (a.start_date AT TIME ZONE '${tz}'))::date::text AS week_start,
          ${selectExprs}
        FROM activities a
        JOIN activity_streams s ON s.activity_id = a.id
        CROSS JOIN LATERAL (
          SELECT
            ${lateralExprs}
          FROM (
            SELECT
              idx,
              ${windowExprs}
            FROM unnest(s.watts) WITH ORDINALITY AS t(w, idx)
          ) sub
        ) bp
        WHERE a.sport_type = ANY($1::text[])
          AND a.start_date >= NOW() - INTERVAL '26 weeks'
          AND array_length(s.watts, 1) >= ${minSeconds}
        GROUP BY week_start
        ORDER BY week_start
      `, [CYCLING_TYPES]);

      const currentRes = await client.query(`
        SELECT
          ${selectExprs}
        FROM activities a
        JOIN activity_streams s ON s.activity_id = a.id
        CROSS JOIN LATERAL (
          SELECT
            ${lateralExprs}
          FROM (
            SELECT
              idx,
              ${windowExprs}
            FROM unnest(s.watts) WITH ORDINALITY AS t(w, idx)
          ) sub
        ) bp
        WHERE a.sport_type = ANY($1::text[])
          AND a.start_date >= NOW() - INTERVAL '90 days'
          AND array_length(s.watts, 1) >= ${minSeconds}
      `, [CYCLING_TYPES]);

      const current = currentRes.rows[0] ?? {};

      // Build targets with colour, using profile watts or FTP-derived fallback
      const targets = durations.map((d, i) => {
        const match = profileTargets.find(t => t.seconds === d.seconds);
        const targetWatts = match
          ? match.target_watts
          : Math.round(ftp * (FTP_MULTIPLIERS[d.seconds] ?? 1.0));
        return {
          key:          `d_${d.seconds}`,
          label:        d.label,
          seconds:      d.seconds,
          repeats:      match?.repeats ?? null,
          target_watts: targetWatts,
          color:        COLORS[i % COLORS.length],
          source:       match ? 'profile' as const : 'ftp' as const,
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
