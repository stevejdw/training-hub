import pool from '@/lib/db';

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

export async function listPlans(): Promise<Omit<TrainingPlan, 'days'>[]> {
  await ensureTables();
  const client = await pool.connect();
  try {
    const res = await client.query(
      'SELECT id, name, goal, created_at FROM training_plans ORDER BY created_at DESC'
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
