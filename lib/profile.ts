import { PoolClient } from 'pg';
import pool from './db';

export interface EventClimb {
  name: string;
  start_km: number;
  end_km: number;
  distance_km: number;
  elevation_gain: number;
  avg_gradient: number;
  target_watts: number;
}

export interface CachedRoute {
  id: string;
  name: string;
  distance_m: number;
  elevation_gain: number;
  stream_distance_km: number[];      // downsampled, km from start
  stream_altitude_m:  number[];      // downsampled, meters
  stream_latlng?:     [number, number][];  // downsampled [lat, lng] pairs for map
}

export interface PacingStrategy {
  flat_watts:          number;
  flat_speed_kmh?:     number;   // optional speed cap for flat sections (km/h)
  descent_watts:       number;
  descent_speed_kmh?:  number;   // braking speed cap for descents (km/h)
  bike_weight_kg:      number;
  accessories_kg?:     number;   // water, food, clothing (default 2 kg)
  cda?:                number;   // drag area m² (default 0.35)
  crr?:                number;   // rolling resistance (default 0.0045)
  climbs:              EventClimb[];
  est_time_min:        number;
}

export interface EventGoal {
  id?:                   string;   // stable slug — set on creation
  name:                  string;
  date:                  string;   // YYYY-MM-DD
  goal:                  string;
  location?:             string;
  strava_route_id?:      string;
  route?:                CachedRoute | null;
  pacing_strategy?:      PacingStrategy | null;
  linked_activity_ids?:  number[];  // Strava activity IDs ridden on this route
}

export interface PowerTarget {
  id: string;
  label: string;       // e.g. "5 min", "20 min"
  seconds: number;
  repeats?: number;    // e.g. 3 for "3×5 min"
  target_watts: number;
  notes: string;
}

export interface AthleteProfile {
  name: string;
  ftp: number;
  use_eftp: boolean;
  eftp: number | null;
  weight_kg: number | null;
  training_goals: string;  // legacy free-text, kept for backward compat
  goals: string[];         // structured list of training goals
  events: EventGoal[];
  power_targets: PowerTarget[];
  training_notes: string;
  timezone: string; // IANA timezone, e.g. 'Australia/Sydney'
  // HR zones
  max_hr: number | null;
  lthr: number | null;
  hr_zones_auto: boolean;
  hr_zone_boundaries: number[] | null; // [z1_max, z2_max, z3_max, z4_max]
  // Power zones
  power_zones_auto: boolean;
  power_zone_boundaries: number[] | null; // [z1_max, z2_max, z3_max, z4_max] in watts
  // Bike
  bike_weight_kg?: number | null;
  // Coach AI
  coach_persona?: string;
  // AI Settings — structured guidance for the coaching model
  ai_coaching_feedback?: string;
  ai_training_plan_guidance?: string;
  ai_communication_style?: string;
  // intervals.icu integration
  intervals_athlete_id?: string;
  intervals_api_key?: string;
  intervals_last_synced?: string; // ISO date of most recent wellness record synced
  // Weekly TSS targets configuration (for rolling 4-week chart)
  tss_plan?: TssPlanConfig;
  // Activity IDs excluded from aerobic efficiency analysis
  excluded_rides?: number[];
  // PWA home screen icon
  app_icon?: 'gear' | 'minimalist' | 'path' | 'speed';
}

export interface TssPlanConfig {
  mode:                'plan' | 'formula'; // 'plan' = sum training_days.tss_target; 'formula' = compute below
  starting_tss:        number;             // base TSS for first build week of cycle
  weekly_increase_pct: number;             // % compound increase per build week (e.g. 5)
  block_weeks:         3 | 4;              // block size; final week of block is recovery
  recovery_pct:        number;             // recovery week TSS as % of last build week (e.g. 65)
  anchor_date:         string;             // YYYY-MM-DD Monday of week 1 of the periodization cycle
}

const DEFAULTS: AthleteProfile = {
  name: 'Steve',
  ftp: Number(process.env.ATHLETE_FTP) || 340,
  use_eftp: false,
  eftp: null,
  weight_kg: null,
  training_goals: '',
  goals: [],
  events: [],
  power_targets: [],
  training_notes: '',
  timezone: 'Australia/Sydney',
  max_hr: null,
  lthr: null,
  hr_zones_auto: true,
  hr_zone_boundaries: null,
  power_zones_auto: true,
  power_zone_boundaries: null,
  bike_weight_kg: null,
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

/** Get the athlete's Lactate Threshold HR, falling back to 90% of max_hr. */
export function effectiveLthr(profile: AthleteProfile): number | null {
  if (profile.lthr) return profile.lthr;
  if (profile.max_hr) return Math.round(profile.max_hr * 0.9);
  return null;
}
