import pool from '@/lib/db';
import { getProfile, effectiveFtp } from '@/lib/profile';
import { calculateFitness } from '@/lib/fitness';
import { calendarDaysFromToday } from '@/lib/calendar-days';

export const runtime = 'nodejs';

import { CYCLING_TYPES } from '@/lib/sport-types';

const PR_DURATIONS = [
  { label: '1 min',  seconds: 60 },
  { label: '5 min',  seconds: 300 },
  { label: '10 min', seconds: 600 },
  { label: '20 min', seconds: 1200 },
];

/**
 * Read this ride's best power and the all-time best (excluding this ride)
 * for each PR duration, from the pre-computed best_power_efforts table.
 * One round trip replaces fetching the full watts stream and computing
 * rolling bests at request time.
 */
async function powerBests(
  client: import('pg').PoolClient,
  activityId: number,
): Promise<Map<number, { ride: number; prev: number | null }>> {
  const secondsList = PR_DURATIONS.map(d => d.seconds);
  const res = await client.query(`
    SELECT seconds,
           MAX(best_watts) FILTER (WHERE activity_id =  $1)::int AS ride_watts,
           MAX(best_watts) FILTER (WHERE activity_id != $1)::int AS prev_watts
    FROM best_power_efforts
    WHERE sport_type = ANY($2::text[])
      AND seconds = ANY($3::int[])
    GROUP BY seconds
  `, [activityId, CYCLING_TYPES, secondsList]);

  const map = new Map<number, { ride: number; prev: number | null }>();
  for (const row of res.rows) {
    const ride = Number(row.ride_watts);
    const prev = Number(row.prev_watts);
    if (Number.isFinite(ride) && ride > 0) {
      map.set(Number(row.seconds), { ride, prev: Number.isFinite(prev) && prev > 0 ? prev : null });
    }
  }
  return map;
}

export async function GET() {
  // Fetch profile before acquiring the pool client so we never hold two
  // connections simultaneously (pool max is 5; concurrent page-load requests
  // would otherwise exhaust it and cause connection-timeout 500s).
  const profile = await getProfile();
  const client = await pool.connect();
  try {
    const tz = profile.timezone || 'Australia/Sydney';

    const statsQuery = (truncUnit: string) => client.query(`
      SELECT
        COUNT(*)                                   AS rides,
        ROUND(COALESCE(SUM(distance)/1000, 0)::numeric, 1) AS km,
        ROUND(COALESCE(SUM(moving_time)/3600.0, 0)::numeric, 1) AS hours,
        COALESCE(SUM(COALESCE(tss, hrss, 0)), 0)::int AS tss,
        ROUND(COALESCE(SUM(total_elevation_gain), 0)::numeric) AS elevation
      FROM activities
      WHERE sport_type NOT ILIKE '%walk%'
        AND start_date >= date_trunc($2, NOW() AT TIME ZONE $1) AT TIME ZONE $1
    `, [tz, truncUnit]);

    // All of these are independent — one parallel wave instead of three
    // sequential ones (each wave is a full round trip to the database).
    const [ridesRes, dailyTssRes, nextSessionRes, wtdRes, mtdRes, ytdRes] = await Promise.all([
      client.query(`
        SELECT id, name, sport_type, start_date, distance, moving_time,
               average_watts, normalized_power, average_heartrate, tss,
               total_elevation_gain, trainer, summary_polyline,
               average_speed, intensity_factor
        FROM activities
        WHERE sport_type NOT ILIKE '%walk%'
        ORDER BY start_date DESC
        LIMIT 50
      `),
      client.query(`
        SELECT TO_CHAR(start_date AT TIME ZONE $1,'YYYY-MM-DD') AS date,
                SUM(COALESCE(tss, hrss, 0)) AS tss
        FROM activities
        GROUP BY 1 ORDER BY 1
      `, [tz]),
      // Next non-rest training day from the active plan.
      // Skip today if a cycling activity was already logged today.
      client.query(`
        SELECT d.id, d.date::text AS date, d.title, d.type, d.duration_min, d.tss_target, d.description
        FROM training_days d
        JOIN training_plans p ON p.id = d.plan_id
        WHERE p.id = (SELECT id FROM training_plans ORDER BY created_at DESC LIMIT 1)
          AND d.date >= (NOW() AT TIME ZONE $1)::date
          AND d.type != 'rest'
          AND NOT (
            d.date = (NOW() AT TIME ZONE $1)::date
            AND EXISTS (
              SELECT 1 FROM activities
              WHERE (start_date AT TIME ZONE $1)::date = (NOW() AT TIME ZONE $1)::date
                AND sport_type = ANY(ARRAY['Ride','GravelRide','EMountainBikeRide','MountainBikeRide',
                                           'EBikeRide','VirtualRide','Workout'])
            )
          )
        ORDER BY d.date
        LIMIT 1
      `, [tz]),
      statsQuery('week'),
      statsQuery('month'),
      statsQuery('year'),
    ]);
    const nextSession = nextSessionRes.rows[0] ?? null;

    const dailyTss = dailyTssRes.rows.map(r => ({ date: String(r.date), tss: Number(r.tss) }));
    const fitness = calculateFitness(dailyTss);

    const eftp = effectiveFtp(profile);
    const vo2max = profile.weight_kg && profile.weight_kg > 0
      ? Math.round(((eftp / profile.weight_kg) * 10.8 + 7) * 10) / 10
      : null;

    // Next event
    const today = new Date().toISOString().slice(0, 10);
    const nextEvent = profile.events
      .filter(e => e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
    const daysAway = nextEvent ? calendarDaysFromToday(nextEvent.date) : null;

    // Find last cycling ride that has a watts stream
    const CYCLING = ['Ride','VirtualRide','GravelRide','MountainBikeRide','EBikeRide','EMountainBikeRide'];
    const lastCyclingRide = ridesRes.rows.find(r => CYCLING.includes(r.sport_type));

    const powerHighlights: {
      label: string; seconds: number; watts: number;
      prevBest: number | null; isNew: boolean;
    }[] = [];

    if (lastCyclingRide) {
      // Pre-computed per-activity bests — replaces fetching the full watts
      // stream and running rolling-window maxima at request time.
      const bests = await powerBests(client, Number(lastCyclingRide.id));

      for (const dur of PR_DURATIONS) {
        const entry = bests.get(dur.seconds);
        if (!entry) continue;

        powerHighlights.push({
          label: dur.label,
          seconds: dur.seconds,
          watts: entry.ride,
          prevBest: entry.prev,
          // isNew = this ride's effort beats the best of all OTHER rides
          isNew: entry.prev !== null && entry.ride > entry.prev,
        });
      }
    }

    const toStats = (row: Record<string, unknown>) => ({
      rides:     Number(row.rides),
      km:        Number(row.km),
      hours:     Number(row.hours),
      tss:       Number(row.tss),
      elevation: Number(row.elevation),
    });
    return Response.json({
      recentRides: ridesRes.rows,
      /* Projected, not spread. The full EventGoal carries `route` (a cached
         polyline plus elevation profile) and `pacing_strategy`, neither of
         which the dashboard renders — and this is the highest-frequency
         payload in the app. */
      nextEvent: nextEvent ? {
        id:       nextEvent.id,
        name:     nextEvent.name,
        date:     nextEvent.date,
        goal:     nextEvent.goal,
        location: nextEvent.location ?? null,
        daysAway,
      } : null,
      nextSession,
      fitness,
      powerHighlights,
      lastCyclingRideId: lastCyclingRide?.id ?? null,
      wtd: toStats(wtdRes.rows[0]),
      mtd: toStats(mtdRes.rows[0]),
      ytd: toStats(ytdRes.rows[0]),
      eftp,
      vo2max,
    });
  } catch (err) {
    console.error('Analytics feed error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
