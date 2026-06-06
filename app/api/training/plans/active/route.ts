import pool from '@/lib/db';
import { listPlans, getPlan, pickActivePlan } from '@/lib/training-plans';
import { getProfile } from '@/lib/profile';
import { todayInTimezone } from '@/lib/timezone';

export const runtime = 'nodejs';

/**
 * Returns the plans list + full active plan content + activities in one shot,
 * eliminating the 3-step waterfall on the Training page.
 *
 * The "active" plan is chosen by date range (see pickActivePlan), not simply
 * the most recently created one — so a second plan scheduled to start after
 * the current block finishes only becomes active once its dates arrive.
 */
export async function GET() {
  try {
    // Step 1: get plans list (with date ranges) + profile timezone in parallel
    const [plans, profile] = await Promise.all([listPlans(), getProfile()]);

    if (plans.length === 0) {
      return Response.json({ plans: [], plan: null, activities: [] });
    }

    const today = todayInTimezone(profile.timezone || 'Australia/Sydney');
    const activePlan = pickActivePlan(plans, today) ?? plans[0];

    // Step 2: fetch plan content + activities in parallel
    const [plan, activities] = await Promise.all([
      getPlan(activePlan.id),
      (async () => {
        if (!activePlan) return [];
        // We need the date range — fetch it quickly from training_days
        const client = await pool.connect();
        try {
          const datesRes = await client.query(
            `SELECT MIN(date)::text AS from_date, MAX(date)::text AS to_date
             FROM training_days WHERE plan_id = $1`,
            [activePlan.id]
          );
          const { from_date, to_date } = datesRes.rows[0];
          if (!from_date || !to_date) return [];

          const res = await client.query(`
            SELECT
              id, name, sport_type,
              (start_date AT TIME ZONE 'Australia/Sydney')::date::text AS date,
              moving_time, distance, total_elevation_gain,
              average_watts, normalized_power, weighted_average_watts,
              average_heartrate, COALESCE(tss, hrss, 0)::int AS tss, intensity_factor
            FROM activities
            WHERE (start_date AT TIME ZONE 'Australia/Sydney')::date >= $1
              AND (start_date AT TIME ZONE 'Australia/Sydney')::date <= $2
              AND sport_type = ANY($3::text[])
            ORDER BY start_date
          `, [from_date, to_date, ['Ride','VirtualRide','GravelRide','MountainBikeRide','EBikeRide','EMountainBikeRide']]);
          return res.rows;
        } finally {
          client.release();
        }
      })(),
    ]);

    return Response.json({ plans, plan, activities, today, activePlanId: activePlan.id });
  } catch (err) {
    console.error('Active plan error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
