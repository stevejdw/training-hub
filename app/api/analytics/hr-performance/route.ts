import pool from '@/lib/db';
import { getProfile } from '@/lib/profile';
import { hrZoneDefs } from '@/lib/zones';

export const runtime = 'nodejs';
export const maxDuration = 45;

const CYCLING = ['Ride','VirtualRide','GravelRide','MountainBikeRide','EBikeRide','EMountainBikeRide'];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const weeks = Math.min(Math.max(Number(searchParams.get('weeks') ?? 16), 4), 52);

  try {
    const profile = await getProfile();
    const tz = profile.timezone || 'Australia/Sydney';

    const maxHr = profile.max_hr;
    const zones = maxHr
      ? hrZoneDefs(maxHr, profile.hr_zones_auto ? null : profile.hr_zone_boundaries)
      : null;

    const client = await pool.connect();
    try {
      // Aerobic efficiency (NP or avg watts / avg HR) from activities table — lightweight
      const effRes = await client.query(`
        SELECT
          date_trunc('week', (start_date AT TIME ZONE '${tz}'))::date::text AS week_start,
          ROUND(AVG(
            CASE
              WHEN average_heartrate > 60 AND (normalized_power IS NOT NULL OR average_watts IS NOT NULL)
              THEN COALESCE(normalized_power, average_watts)::numeric / average_heartrate
            END
          )::numeric, 2) AS efficiency,
          COUNT(*) FILTER (WHERE average_heartrate > 60) AS ride_count
        FROM activities
        WHERE sport_type = ANY($1::text[])
          AND start_date >= NOW() - ($2 || ' weeks')::interval
          AND (normalized_power IS NOT NULL OR average_watts IS NOT NULL)
          AND average_heartrate IS NOT NULL
        GROUP BY week_start
        ORDER BY week_start
      `, [CYCLING, weeks]);

      let zoneWeekly: Record<string, unknown>[] = [];

      if (zones) {
        // Zone time per week using HR stream data
        // Embed boundaries directly (integer arithmetic, not user input)
        const b = zones.map(z => z.max ?? 999);

        const zoneRes = await client.query(`
          SELECT
            date_trunc('week', (a.start_date AT TIME ZONE '${tz}'))::date::text AS week_start,
            COUNT(*) FILTER (WHERE h.val > 30 AND h.val <= ${b[0]}) AS z1,
            COUNT(*) FILTER (WHERE h.val > ${b[0]} AND h.val <= ${b[1]}) AS z2,
            COUNT(*) FILTER (WHERE h.val > ${b[1]} AND h.val <= ${b[2]}) AS z3,
            COUNT(*) FILTER (WHERE h.val > ${b[2]} AND h.val <= ${b[3]}) AS z4,
            COUNT(*) FILTER (WHERE h.val > ${b[3]} AND h.val <= 999) AS z5,
            COUNT(*) FILTER (WHERE h.val > 30) AS total
          FROM activities a
          JOIN activity_streams s ON s.activity_id = a.id
          CROSS JOIN LATERAL unnest(s.hr) AS h(val)
          WHERE a.sport_type = ANY($1::text[])
            AND a.start_date >= NOW() - ($2 || ' weeks')::interval
            AND s.hr IS NOT NULL
          GROUP BY week_start
          ORDER BY week_start
        `, [CYCLING, weeks]);

        zoneWeekly = zoneRes.rows.map(r => ({
          week_start: r.week_start,
          z1_min: Math.round(Number(r.z1) / 60),
          z2_min: Math.round(Number(r.z2) / 60),
          z3_min: Math.round(Number(r.z3) / 60),
          z4_min: Math.round(Number(r.z4) / 60),
          z5_min: Math.round(Number(r.z5) / 60),
          total_min: Math.round(Number(r.total) / 60),
        }));
      }

      // Merge efficiency + zone data by week
      const weekMap = new Map<string, Record<string, unknown>>();
      for (const r of effRes.rows) {
        weekMap.set(r.week_start, {
          week_start: r.week_start,
          efficiency: r.efficiency ? Number(r.efficiency) : null,
          ride_count: Number(r.ride_count),
        });
      }
      for (const r of zoneWeekly) {
        const week = r.week_start as string;
        weekMap.set(week, { ...(weekMap.get(week) ?? { week_start: week }), ...r });
      }

      const weekly = Array.from(weekMap.values()).sort((a, b) =>
        String(a.week_start).localeCompare(String(b.week_start))
      );

      return Response.json({
        weekly,
        zones: zones
          ? zones.map(z => ({ z: z.z, name: z.name, color: z.color, min: z.min, max: z.max }))
          : null,
        max_hr: maxHr,
        has_zone_data: zoneWeekly.length > 0,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('HR performance error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
