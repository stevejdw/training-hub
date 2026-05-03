import { PoolClient } from 'pg';
import pool from '@/lib/db';
import { getProfile, saveProfile } from '@/lib/profile';

export const runtime    = 'nodejs';
export const maxDuration = 60;

async function ensureTable(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS daily_wellness (
      date            DATE PRIMARY KEY,
      hrv_rmssd       FLOAT,
      hrv_sdnn        FLOAT,
      resting_hr      INT,
      sleep_score     INT,
      readiness_score INT,
      sleep_secs      INT,
      source          TEXT DEFAULT 'intervals',
      synced_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

/**
 * GET /api/intervals/sync
 * Returns { count, oldestDate, newestDate } from daily_wellness.
 */
export async function GET() {
  const client = await pool.connect();
  try {
    await ensureTable(client);
    const res = await client.query(`
      SELECT
        COUNT(*)      AS total,
        MIN(date)     AS oldest,
        MAX(date)     AS newest
      FROM daily_wellness
    `);
    const row = res.rows[0] ?? {};
    return Response.json({
      total:      Number(row.total ?? 0),
      oldestDate: row.oldest ?? null,
      newestDate: row.newest ?? null,
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}

/**
 * POST /api/intervals/sync  { days?: number }
 * Fetches wellness data from intervals.icu and upserts into daily_wellness.
 * Default 90 days incremental; pass days=365 for backfill.
 * Returns { synced, oldestDate, newestDate }.
 */
export async function POST(req: Request) {
  const profile = await getProfile();

  const athleteId = profile.intervals_athlete_id?.trim();
  const apiKey    = profile.intervals_api_key?.trim();

  if (!athleteId || !apiKey) {
    return Response.json(
      { error: 'intervals.icu Athlete ID and API Key are required. Add them in Settings.' },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({})) as { days?: number };
  const days = body.days ?? 90;

  const newest = new Date();
  const oldest = new Date(newest);
  oldest.setDate(oldest.getDate() - days);

  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const url = `https://intervals.icu/api/v1/athlete/${athleteId}/wellness?oldest=${fmt(oldest)}&newest=${fmt(newest)}`;

  const auth = Buffer.from(`API_KEY:${apiKey}`).toString('base64');

  let wellnessRows: Record<string, unknown>[];
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: `intervals.icu API error ${res.status}: ${text}` }, { status: 502 });
    }
    wellnessRows = await res.json() as Record<string, unknown>[];
  } catch (err) {
    return Response.json({ error: `Fetch failed: ${String(err)}` }, { status: 502 });
  }

  if (!Array.isArray(wellnessRows)) {
    return Response.json({ error: 'Unexpected response from intervals.icu' }, { status: 502 });
  }

  const client = await pool.connect();
  try {
    await ensureTable(client);

    // Log available fields from first row to help debug field name issues
    const sampleFields = wellnessRows.length > 0 ? Object.keys(wellnessRows[0]) : [];

    let synced = 0;
    for (const row of wellnessRows) {
      const date = row.id as string; // intervals.icu uses 'id' for the date field (YYYY-MM-DD)
      if (!date) continue;

      await client.query(`
        INSERT INTO daily_wellness
          (date, hrv_rmssd, hrv_sdnn, resting_hr, sleep_score, readiness_score, sleep_secs, source, synced_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'intervals', NOW())
        ON CONFLICT (date) DO UPDATE SET
          hrv_rmssd       = EXCLUDED.hrv_rmssd,
          hrv_sdnn        = EXCLUDED.hrv_sdnn,
          resting_hr      = EXCLUDED.resting_hr,
          sleep_score     = EXCLUDED.sleep_score,
          readiness_score = EXCLUDED.readiness_score,
          sleep_secs      = EXCLUDED.sleep_secs,
          source          = EXCLUDED.source,
          synced_at       = NOW()
      `, [
        date,
        toFloatOrNull(row.hrv_rmssd  ?? row.hrvRMSSD  ?? row.hrv),
        toFloatOrNull(row.hrv_sdnn   ?? row.hrvSDNN),
        toIntOrNull(row.restingHR    ?? row.resting_hr),
        toIntOrNull(row.sleepScore   ?? row.sleep_score),
        // intervals.icu field is 'readiness', not 'score'
        toIntOrNull(row.readiness    ?? row.readinessScore ?? row.score ?? row.readiness_score),
        toIntOrNull(row.sleepSecs    ?? row.sleep_secs),
      ]);
      synced++;
    }

    // Update last synced date in profile
    const updatedProfile = { ...profile, intervals_last_synced: fmt(newest) };
    await saveProfile(updatedProfile);

    // Return summary + field names for debugging
    const summary = await client.query(`
      SELECT MIN(date) AS oldest, MAX(date) AS newest FROM daily_wellness
    `);
    const s = summary.rows[0] ?? {};
    return Response.json({ synced, oldestDate: s.oldest ?? null, newestDate: s.newest ?? null, sampleFields });
  } catch (err) {
    console.error('[intervals sync POST]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}

function toFloatOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function toIntOrNull(v: unknown): number | null {
  const n = toFloatOrNull(v);
  return n !== null ? Math.round(n) : null;
}
