import pool from '@/lib/db';
import { getProfile } from '@/lib/profile';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

const ALL_SPORT_TYPES = [
  'Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide',
  'EBikeRide', 'EMountainBikeRide', 'Run', 'Walk', 'Swim',
  'WeightTraining', 'Yoga', 'Hike',
];

/** Inclusive list of Mon–Sun day strings for the ISO week containing `dateStr`. */
function weekDays(monDateStr: string): string[] {
  const [yr, mo, dy] = monDateStr.split('-').map(Number);
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.UTC(yr, mo - 1, dy + i));
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/**
 * GET /api/training/calendar
 *
 * Query params:
 *   weeks  = number of weeks to return (default 8, max 52)
 *
 * Returns calendar data for the most recent N weeks (Mon–Sun),
 * including activities and training plan days per day.
 */
export async function GET(req: NextRequest) {
  const sp    = req.nextUrl.searchParams;
  const weeks = Math.min(52, Math.max(1, parseInt(sp.get('weeks') ?? '8', 10)));

  try {
    const profile = await getProfile();
    const tz = profile.timezone || 'Australia/Sydney';

    const client = await pool.connect();
    try {
      // Get today in user's timezone
      const { rows: [{ today }] } = await client.query<{ today: string }>(
        `SELECT ((NOW() AT TIME ZONE $1)::date)::text AS today`, [tz]
      );

      // Compute the Monday of the current week
      const [ty, tm, td] = today.split('-').map(Number);
      const todayUTC = new Date(Date.UTC(ty, tm - 1, td));
      const dow = (todayUTC.getUTCDay() + 6) % 7; // 0=Mon … 6=Sun
      const thisMonday = new Date(Date.UTC(ty, tm - 1, td - dow));

      // Build an array of week-start Mondays (oldest first)
      const weekStarts: string[] = [];
      for (let i = weeks - 1; i >= 0; i--) {
        const d = new Date(thisMonday.getTime() - i * 7 * 86400000);
        weekStarts.push(d.toISOString().slice(0, 10));
      }

      const fromDate = weekStarts[0];
      // to = Sunday of last week (thisMonday + 6 days)
      const toDate = new Date(thisMonday.getTime() + 6 * 86400000).toISOString().slice(0, 10);

      // Fetch activities in range
      const actsRes = await client.query<{
        id: number; name: string; sport_type: string;
        act_date: string; moving_time: number; distance: number; tss: number;
      }>(`
        SELECT
          id,
          name,
          sport_type,
          (start_date AT TIME ZONE $1)::date::text AS act_date,
          moving_time,
          ROUND((distance / 1000.0)::numeric, 1)::float AS distance,
          COALESCE(tss, 0)::int AS tss
        FROM activities
        WHERE (start_date AT TIME ZONE $1)::date >= $2
          AND (start_date AT TIME ZONE $1)::date <= $3
          AND sport_type = ANY($4::text[])
        ORDER BY start_date
      `, [tz, fromDate, toDate, ALL_SPORT_TYPES]);

      // Fetch training plan days in range (most recent plan)
      const planRes = await client.query<{
        date: string; title: string; type: string; tss_target: number | null;
      }>(`
        SELECT
          date::text,
          title,
          type,
          tss_target
        FROM training_days
        WHERE date >= $1
          AND date <= $2
          AND plan_id = (SELECT id FROM training_plans ORDER BY created_at DESC LIMIT 1)
        ORDER BY date
      `, [fromDate, toDate]);

      // Index by date for fast lookup
      const actsByDate = new Map<string, typeof actsRes.rows>();
      for (const a of actsRes.rows) {
        const arr = actsByDate.get(a.act_date) ?? [];
        arr.push(a);
        actsByDate.set(a.act_date, arr);
      }

      const planByDate = new Map<string, typeof planRes.rows[0]>();
      for (const p of planRes.rows) {
        planByDate.set(p.date, p);
      }

      // Build week structures
      const calendarWeeks = weekStarts.map(monStr => {
        const days = weekDays(monStr);
        let wkKm = 0, wkSec = 0, wkTss = 0, wkActs = 0;

        const dayData = days.map(dateStr => {
          const acts = actsByDate.get(dateStr) ?? [];
          const plan = planByDate.get(dateStr) ?? null;

          // Determine match status
          let matchStatus: 'match' | 'extra' | 'missed' | null = null;
          if (acts.length > 0 && plan) matchStatus = 'match';
          else if (acts.length > 0 && !plan) matchStatus = 'extra';
          else if (acts.length === 0 && plan) matchStatus = 'missed';

          // Accum week totals
          for (const a of acts) {
            wkKm  += a.distance;
            wkSec += a.moving_time;
            wkTss += a.tss;
            wkActs++;
          }

          return {
            date: dateStr,
            isToday: dateStr === today,
            isFuture: dateStr > today,
            activities: acts.map(a => ({
              id:         a.id,
              name:       a.name,
              sport_type: a.sport_type,
              km:         a.distance,
              hours:      Math.round((a.moving_time / 3600) * 10) / 10,
              tss:        a.tss,
            })),
            plan: plan ? {
              title:      plan.title,
              type:       plan.type,
              tss_target: plan.tss_target,
            } : null,
            match_status: matchStatus,
          };
        });

        return {
          week_start: monStr,
          days:       dayData,
          totals: {
            km:         Math.round(wkKm * 10) / 10,
            hours:      Math.round((wkSec / 3600) * 10) / 10,
            tss:        wkTss,
            activities: wkActs,
          },
        };
      });

      return Response.json({ weeks: calendarWeeks, today });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Calendar API error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
