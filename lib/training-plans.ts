import pool from '@/lib/db';
import { PlanSummary } from '@/lib/plan-status';

export type { PlanSummary } from '@/lib/plan-status';
export { planStatus, pickActivePlan, isInFinalWeek } from '@/lib/plan-status';

export interface TrainingSegment {
  type: 'warmup' | 'main' | 'cooldown' | 'interval';
  duration_min: number;
  description: string;
  target_np_watts?: number | null;
  target_avg_hr?: number | null;
  zone?: string | null;
  notes?: string | null;
}

export interface TrainingDay {
  id: number;
  plan_id: number;
  date: string; // YYYY-MM-DD
  title: string;
  type: 'rest' | 'endurance' | 'tempo' | 'threshold' | 'vo2max' | 'race' | 'recovery';
  duration_min: number;
  tss_target: number | null;
  description: string;
  segments: TrainingSegment[];
}

export interface TrainingPlan {
  id: number;
  name: string;
  goal: string;
  created_at: string;
  days: TrainingDay[];
}

export async function ensureTables() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS training_plans (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL,
        goal       TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS training_days (
        id           SERIAL PRIMARY KEY,
        plan_id      INTEGER NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
        date         DATE NOT NULL,
        title        TEXT NOT NULL DEFAULT '',
        type         TEXT NOT NULL DEFAULT 'endurance',
        duration_min INTEGER NOT NULL DEFAULT 60,
        tss_target   INTEGER,
        description  TEXT NOT NULL DEFAULT '',
        segments     JSONB NOT NULL DEFAULT '[]'
      )
    `);
  } finally {
    client.release();
  }
}

export async function listPlans(): Promise<PlanSummary[]> {
  await ensureTables();
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT p.id, p.name, p.goal, p.created_at,
              MIN(d.date)::text AS start_date,
              MAX(d.date)::text AS end_date
       FROM training_plans p
       LEFT JOIN training_days d ON d.plan_id = p.id
       GROUP BY p.id, p.name, p.goal, p.created_at
       ORDER BY p.created_at DESC`
    );
    return res.rows;
  } finally {
    client.release();
  }
}

export async function getPlan(id: number): Promise<TrainingPlan | null> {
  await ensureTables();
  const client = await pool.connect();
  try {
    const planRes = await client.query(
      'SELECT id, name, goal, created_at FROM training_plans WHERE id = $1',
      [id]
    );
    if (!planRes.rows.length) return null;
    const plan = planRes.rows[0];

    const daysRes = await client.query(
      `SELECT id, plan_id, date::text, title, type, duration_min, tss_target, description, segments
       FROM training_days WHERE plan_id = $1 ORDER BY date`,
      [id]
    );

    return {
      ...plan,
      days: daysRes.rows.map(r => ({
        ...r,
        segments: Array.isArray(r.segments) ? r.segments : JSON.parse(r.segments ?? '[]'),
      })),
    };
  } finally {
    client.release();
  }
}

export async function createPlan(name: string, goal: string, days: Omit<TrainingDay, 'id' | 'plan_id'>[]): Promise<TrainingPlan> {
  await ensureTables();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const planRes = await client.query(
      'INSERT INTO training_plans (name, goal) VALUES ($1, $2) RETURNING id, name, goal, created_at',
      [name, goal]
    );
    const plan = planRes.rows[0];

    for (const day of days) {
      await client.query(
        `INSERT INTO training_days (plan_id, date, title, type, duration_min, tss_target, description, segments)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [plan.id, day.date, day.title ?? '', day.type ?? 'rest', day.duration_min ?? 0, day.tss_target ?? null, day.description ?? '', JSON.stringify(day.segments ?? [])]
      );
    }

    await client.query('COMMIT');
    return { ...plan, days };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function deletePlan(id: number): Promise<void> {
  await ensureTables();
  const client = await pool.connect();
  try {
    await client.query('DELETE FROM training_plans WHERE id = $1', [id]);
  } finally {
    client.release();
  }
}

export async function updateTrainingDay(
  dayId: number,
  fields: Partial<Pick<TrainingDay, 'title' | 'type' | 'duration_min' | 'tss_target' | 'description' | 'segments' | 'date'>>,
): Promise<void> {
  const client = await pool.connect();
  try {
    const updates: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (fields.title !== undefined)        { updates.push(`title = $${i++}`);        values.push(fields.title); }
    if (fields.type !== undefined)         { updates.push(`type = $${i++}`);         values.push(fields.type); }
    if (fields.duration_min !== undefined) { updates.push(`duration_min = $${i++}`); values.push(fields.duration_min); }
    if (fields.tss_target !== undefined)   { updates.push(`tss_target = $${i++}`);   values.push(fields.tss_target); }
    if (fields.description !== undefined)  { updates.push(`description = $${i++}`);  values.push(fields.description); }
    if (fields.segments !== undefined)     { updates.push(`segments = $${i++}`);     values.push(JSON.stringify(fields.segments)); }
    if (fields.date !== undefined)         { updates.push(`date = $${i++}`);         values.push(fields.date); }
    if (!updates.length) return;
    values.push(dayId);
    await client.query(`UPDATE training_days SET ${updates.join(', ')} WHERE id = $${i}`, values);
  } finally {
    client.release();
  }
}

export async function deleteTrainingDay(dayId: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('DELETE FROM training_days WHERE id = $1', [dayId]);
  } finally {
    client.release();
  }
}

/**
 * Repair corrupted plan dates by reassigning sequential daily dates.
 *
 * Sorts all days in the plan by (date ASC, id ASC), takes the earliest
 * date as the plan start, then assigns startDate+0, startDate+1, … to
 * each row in order.  This fixes cases where repeated swap operations
 * left multiple rows sharing the same date (all showing the same number
 * in the UI).
 */
export async function repairPlanDates(planId: number): Promise<void> {
  await ensureTables();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const res = await client.query<{ id: number; date: string }>(
      `SELECT id, date::text FROM training_days WHERE plan_id = $1 ORDER BY date ASC, id ASC`,
      [planId],
    );

    if (res.rows.length === 0) { await client.query('ROLLBACK'); return; }

    const startMs = new Date(res.rows[0].date + 'T00:00:00Z').getTime();

    for (let i = 0; i < res.rows.length; i++) {
      const newDate = new Date(startMs + i * 86400000).toISOString().slice(0, 10);
      await client.query(
        `UPDATE training_days SET date = $1 WHERE id = $2`,
        [newDate, res.rows[i].id],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updatePlanMeta(planId: number, name: string, goal: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('UPDATE training_plans SET name = $1, goal = $2 WHERE id = $3', [name, goal, planId]);
  } finally {
    client.release();
  }
}

export async function replacePlanDays(
  id: number,
  goal: string,
  days: Omit<TrainingDay, 'id' | 'plan_id'>[],
): Promise<void> {
  await ensureTables();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE training_plans SET goal = $1 WHERE id = $2',
      [goal, id],
    );
    await client.query('DELETE FROM training_days WHERE plan_id = $1', [id]);
    for (const day of days) {
      await client.query(
        `INSERT INTO training_days (plan_id, date, title, type, duration_min, tss_target, description, segments)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, day.date, day.title ?? '', day.type ?? 'rest', day.duration_min ?? 0,
          day.tss_target ?? null, day.description ?? '', JSON.stringify(day.segments ?? [])],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
