import { PoolClient } from 'pg';
import pool from './db';

export interface EventGoal {
  name: string;
  date: string;   // YYYY-MM-DD
  goal: string;
}

export interface AthleteProfile {
  name: string;
  ftp: number;
  use_eftp: boolean;
  eftp: number | null;
  weight_kg: number | null;
  training_goals: string;
  events: EventGoal[];
}

const DEFAULTS: AthleteProfile = {
  name: 'Steve',
  ftp: Number(process.env.ATHLETE_FTP) || 340,
  use_eftp: false,
  eftp: null,
  weight_kg: null,
  training_goals: '',
  events: [],
};

async function ensureTable(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS athlete_profile (
      id      INTEGER PRIMARY KEY DEFAULT 1,
      data    JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

export async function getProfile(): Promise<AthleteProfile> {
  const client = await pool.connect();
  try {
    await ensureTable(client);
    const res = await client.query(`SELECT data FROM athlete_profile WHERE id = 1`);
    if (res.rows.length === 0) return DEFAULTS;
    return { ...DEFAULTS, ...res.rows[0].data };
  } finally {
    client.release();
  }
}

export async function saveProfile(profile: AthleteProfile): Promise<void> {
  const client = await pool.connect();
  try {
    await ensureTable(client);
    await client.query(`
      INSERT INTO athlete_profile (id, data, updated_at)
      VALUES (1, $1::jsonb, NOW())
      ON CONFLICT (id) DO UPDATE SET data = $1::jsonb, updated_at = NOW()
    `, [JSON.stringify(profile)]);
  } finally {
    client.release();
  }
}

export function effectiveFtp(profile: AthleteProfile): number {
  if (profile.use_eftp && profile.eftp) return profile.eftp;
  return profile.ftp;
}
