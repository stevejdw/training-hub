import pool from '@/lib/db';
import { listPlans, getPlan, pickActivePlan } from '@/lib/training-plans';

export const runtime = 'nodejs';

function todaySydney(): string {
  const d = new Date(Date.now() + 10 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export async function GET() {
  const client = await pool.connect();
  try {
    const [activitiesRes, plansMeta] = await Promise.all([
      client.query(`
        SELECT id, name, sport_type, start_date, distance, moving_time,
               average_watts, normalized_power, average_heartrate, tss,
               total_elevation_gain, trainer, summary_polyline,
               average_speed, intensity_factor
        FROM activities
        ORDER BY start_date DESC
        LIMIT 10
      `),
      listPlans(),
    ]);

    let nextDay = null;
    if (plansMeta.length > 0) {
      const today = todaySydney();
      const active = pickActivePlan(plansMeta, today) ?? plansMeta[0];
      const plan = await getPlan(active.id);
      nextDay = plan?.days.find(d => d.date >= today && d.type !== 'rest') ?? null;
    }

    return Response.json({
      activities: activitiesRes.rows,
      nextDay,
    });
  } catch (err) {
    console.error('Feed error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
