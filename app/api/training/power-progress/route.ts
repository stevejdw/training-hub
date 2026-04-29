import pool from '@/lib/db';
import { NextRequest } from 'next/server';
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
  { seconds: 3600, label: '60 min' },
];

/** FTP-relative target for an arbitrary duration. Used when the profile
 *  doesn't have a matching power_target seconds value. Rough rider model:
 *  super-short = anaerobic, getting closer to FTP at 30min, sub-FTP after. */
function ftpMultiplier(seconds: number): number {
  if (seconds <= 30)   return 2.50;
  if (seconds <= 60)   return 1.80;
  if (seconds <= 180)  return 1.40;
  if (seconds <= 300)  return 1.30;
  if (seconds <= 600)  return 1.15;
  if (seconds <= 1200) return 1.05;
  if (seconds <= 1800) return 1.00;
  if (seconds <= 3600) return 0.92;
  return 0.85;
}

function secondsToLabel(s: number): string {
  if (s < 60) return `${s} sec`;
  const m = s / 60;
  if (Number.isInteger(m)) return `${m} min`;
  return `${m.toFixed(1)} min`;
}

// Chart colours — assigned by position
const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#60a5fa', '#a78bfa', '#f472b6'];

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    // Lookback windows. `days` for the "best" tile, `weeks` for the trend line.
    const days  = Math.min(99999, Math.max(1, parseInt(sp.get('days')  ?? '90', 10) || 90));
    const weeks = Math.min(99999, Math.max(1, parseInt(sp.get('weeks') ?? '26', 10) || 26));
    const durationsParam = sp.get('durations');

    const profile = await getProfile();
    const ftp     = effectiveFtp(profile);
    const tz      = profile.timezone || 'Australia/Sydney';

    const profileTargets = profile.power_targets ?? [];

    // Build duration list:
    //   1. If client passed `?durations=180,300,...`, use those verbatim
    //   2. Otherwise: profile targets, padded with DEFAULTS up to 6 entries
    let durations: { seconds: number; label: string }[];
    if (durationsParam) {
      const parsed = durationsParam.split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(s => Number.isInteger(s) && s > 0)
        .map(seconds => ({ seconds, label: secondsToLabel(seconds) }));
      // Dedupe by seconds, keep order
      const seen = new Set<number>();
      durations = parsed.filter(d => seen.has(d.seconds) ? false : (seen.add(d.seconds), true));
    } else {
      durations = profileTargets
        .slice()
        .sort((a, b) => a.seconds - b.seconds)
        .map(t => ({ seconds: t.seconds, label: t.label }));

      if (durations.length < 6) {
        const existing = new Set(durations.map(d => d.seconds));
        for (const def of DEFAULTS) {
          if (!existing.has(def.seconds)) {
            durations.push(def);
            if (durations.length === 6) break;
          }
        }
        durations.sort((a, b) => a.seconds - b.seconds);
      }
    }

    durations = durations.filter(d => Number.isInteger(d.seconds) && d.seconds > 0);

    if (durations.length === 0) {
      return Response.json({ weekly: [], current: {}, targets: [], ftp });
    }

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
          AND a.start_date >= NOW() - INTERVAL '${weeks} weeks'
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
          AND a.start_date >= NOW() - INTERVAL '${days} days'
          AND array_length(s.watts, 1) >= ${minSeconds}
      `, [CYCLING_TYPES]);

      const current = currentRes.rows[0] ?? {};

      const targets = durations.map((d, i) => {
        const match = profileTargets.find(t => t.seconds === d.seconds);
        const targetWatts = match
          ? match.target_watts
          : Math.round(ftp * ftpMultiplier(d.seconds));
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
