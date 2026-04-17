import pool from '@/lib/db';
import { listPlans, getPlan } from '@/lib/training-plans';

export const runtime = 'nodejs';

/**
 * Returns the plans list + full active plan content + activities in one shot,
 * eliminating the 3-step waterfall on the Training page.
 */
export async function GET() {
  try {
    // Step 1: get plans list (fast — metadata only)
    const plans = await listPlans();

    if (plans.length === 0) {
      return Response.json({ plans: [], plan: null, activities: [] });
    }

    const activePlan = plans[0];

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
              average_heartrate, COALESCE(tss, 0)::int AS tss, intensity_factor
            FROM activities
            WHERE (start_date AT TIME ZONE 'Australia/Sydney')::date >= $1
              AND (start_date AT TIME ZONE 'Australia/Sydney')::date <= $2
            ORDER BY start_date
          `, [from_date, to_date]);
          return res.rows;
        } finally {
          client.release();
        }
      })(),
    ]);

    return Response.json({ plans, plan, activities });
  } catch (err) {
    console.error('Active plan error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
