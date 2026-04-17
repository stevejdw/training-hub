import pool from '@/lib/db';
import { getProfile } from '@/lib/profile';
import { calculateFitness } from '@/lib/fitness';

export const runtime = 'nodejs';

const PR_DURATIONS = [
  { label: '1 min',  seconds: 60 },
  { label: '5 min',  seconds: 300 },
  { label: '20 min', seconds: 1200 },
  { label: '60 min', seconds: 3600 },
];

function rollingBest(arr: number[], w: number): number {
  if (!arr?.length || arr.length < w) return 0;
  let sum = 0;
  for (let i = 0; i < w; i++) sum += arr[i] ?? 0;
  let best = sum;
  for (let i = w; i < arr.length; i++) {
    sum += (arr[i] ?? 0) - (arr[i - w] ?? 0);
    if (sum > best) best = sum;
  }
  return Math.round(best / w);
}

async function ensurePRTable(client: import('pg').PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS power_prs (
      duration_seconds INTEGER PRIMARY KEY,
      watts            INTEGER NOT NULL,
      activity_id      BIGINT,
      achieved_at      TIMESTAMPTZ
    )
  `);
}

export async function GET() {
  const client = await pool.connect();
  try {
    await ensurePRTable(client);

    // Parallel: recent rides, daily TSS (for fitness), profile
    const [ridesRes, dailyTssRes, profile] = await Promise.all([
      client.query(`
        SELECT id, name, sport_type, start_date, distance, moving_time,
               average_watts, normalized_power, average_heartrate, tss,
               total_elevation_gain, trainer, summary_polyline,
               average_speed, intensity_factor
        FROM activities
        ORDER BY start_date DESC
        LIMIT 8
      `),
      client.query(`
        SELECT TO_CHAR(start_date AT TIME ZONE 'Australia/Sydney','YYYY-MM-DD') AS date,
               SUM(COALESCE(tss,0)) AS tss
        FROM activities
        GROUP BY 1 ORDER BY 1
      `),
      getProfile(),
    ]);

    const dailyTss = dailyTssRes.rows.map(r => ({ date: String(r.date), tss: Number(r.tss) }));
    const fitness = calculateFitness(dailyTss);

    // Next event
    const today = new Date().toISOString().slice(0, 10);
    const nextEvent = profile.events
      .filter(e => e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
    const daysAway = nextEvent
      ? Math.ceil((new Date(nextEvent.date).getTime() - Date.now()) / 86400000)
      : null;

    // Find last cycling ride that has a watts stream
    const CYCLING = ['Ride','VirtualRide','GravelRide','MountainBikeRide','EBikeRide','EMountainBikeRide'];
    const lastCyclingRide = ridesRes.rows.find(r => CYCLING.includes(r.sport_type));

    let powerHighlights: {
      label: string; seconds: number; watts: number;
      prevBest: number | null; isNew: boolean;
    }[] = [];

    if (lastCyclingRide) {
      const streamRes = await client.query(
        `SELECT watts FROM activity_streams WHERE activity_id = $1`,
        [lastCyclingRide.id]
      );

      if (streamRes.rows[0]?.watts) {
        const wattsArr: number[] = streamRes.rows[0].watts;

        // Load stored PRs
        const prRes = await client.query(`SELECT duration_seconds, watts FROM power_prs`);
        const storedPRs = new Map<number, number>(
          prRes.rows.map((r: { duration_seconds: number; watts: number }) => [r.duration_seconds, r.watts])
        );

        const toUpsert: { seconds: number; watts: number; actId: number }[] = [];

        for (const dur of PR_DURATIONS) {
          const best = rollingBest(wattsArr, dur.seconds);
          if (!best) continue;
          const prev = storedPRs.get(dur.seconds) ?? null;
          const isNew = prev === null || best > prev;

          powerHighlights.push({
            label: dur.label,
            seconds: dur.seconds,
            watts: best,
            prevBest: prev,
            isNew,
          });

          if (isNew) {
            toUpsert.push({ seconds: dur.seconds, watts: best, actId: lastCyclingRide.id });
          }
        }

        // Persist new PRs
        for (const { seconds, watts, actId } of toUpsert) {
          await client.query(`
            INSERT INTO power_prs (duration_seconds, watts, activity_id, achieved_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (duration_seconds) DO UPDATE
              SET watts = $2, activity_id = $3, achieved_at = NOW()
            WHERE power_prs.watts < $2
          `, [seconds, watts, actId]);
        }
      }
    }

    return Response.json({
      recentRides: ridesRes.rows,
      nextEvent: nextEvent ? { ...nextEvent, daysAway } : null,
      fitness,
      powerHighlights,
      lastCyclingRideId: lastCyclingRide?.id ?? null,
    });
  } catch (err) {
    console.error('Analytics feed error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
