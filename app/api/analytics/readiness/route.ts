import { after } from 'next/server';
import pool from '@/lib/db';
import { getProfile } from '@/lib/profile';

export const runtime = 'nodejs';

export interface ReadinessPoint {
  date:            string;
  hrv:             number | null;
  sleep_score:     number | null;
  readiness_score: number | null;
  resting_hr:      number | null;
}

export interface ReadinessResponse {
  points:       ReadinessPoint[];
  zone:         { avg: number; sd: number; upper: number; lower: number } | null;
  recent_avg:   number | null;
  fatigue_alert: boolean;
}

// ---------- auto-sync helpers (see readiness-response/route.ts for docs) ----------

function toFloatOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function toIntOrNull(v: unknown): number | null {
  const n = toFloatOrNull(v);
  return n !== null ? Math.round(n) : null;
}

async function autoSyncWellness(): Promise<void> {
  const profile = await getProfile();
  const athleteId = profile.intervals_athlete_id?.trim();
  const apiKey    = profile.intervals_api_key?.trim();
  if (!athleteId || !apiKey) return;

  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT MAX(date) AS newest FROM daily_wellness`);
    const newest: string | null = res.rows[0]?.newest ?? null;

    if (newest) {
      const newestDate = new Date(newest + 'T00:00:00Z');
      const now = new Date();
      if (now.getTime() - newestDate.getTime() < 24 * 60 * 60 * 1000) return;
    }

    const newestDate = new Date();
    const oldestDate = new Date(newestDate);
    oldestDate.setDate(oldestDate.getDate() - 7);

    const fmt = (d: Date) => d.toISOString().split('T')[0];
    const url = `https://intervals.icu/api/v1/athlete/${athleteId}/wellness?oldest=${fmt(oldestDate)}&newest=${fmt(newestDate)}`;
    const auth = Buffer.from(`API_KEY:${apiKey}`).toString('base64');

    const resFetch = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!resFetch.ok) { console.warn('[readiness autoSync] fetch failed', resFetch.status); return; }

    const wellnessRows = await resFetch.json() as Record<string, unknown>[];
    if (!Array.isArray(wellnessRows) || wellnessRows.length === 0) return;

    // Single multi-row upsert instead of one round-trip per day.
    const values: unknown[] = [];
    const tuples: string[] = [];
    let p = 1;
    for (const row of wellnessRows) {
      const date = row.id as string;
      if (!date) continue;
      tuples.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, 'intervals', NOW())`);
      values.push(
        date,
        toFloatOrNull(row.hrv_rmssd  ?? row.hrvRMSSD  ?? row.hrv),
        toFloatOrNull(row.hrv_sdnn   ?? row.hrvSDNN),
        toIntOrNull(row.restingHR    ?? row.resting_hr),
        toIntOrNull(row.sleepScore   ?? row.sleep_score),
        toIntOrNull(row.readiness    ?? row.readinessScore ?? row.score ?? row.readiness_score),
        toIntOrNull(row.sleepSecs    ?? row.sleep_secs),
        toFloatOrNull(row.icu_tss    ?? row.icuTSS),
      );
    }
    if (tuples.length === 0) return;

    await client.query(`
      INSERT INTO daily_wellness
        (date, hrv_rmssd, hrv_sdnn, resting_hr, sleep_score, readiness_score, sleep_secs, icu_tss, source, synced_at)
      VALUES ${tuples.join(', ')}
      ON CONFLICT (date) DO UPDATE SET
        hrv_rmssd       = EXCLUDED.hrv_rmssd,
        hrv_sdnn        = EXCLUDED.hrv_sdnn,
        resting_hr      = EXCLUDED.resting_hr,
        sleep_score     = EXCLUDED.sleep_score,
        readiness_score = EXCLUDED.readiness_score,
        sleep_secs      = EXCLUDED.sleep_secs,
        icu_tss         = EXCLUDED.icu_tss,
        source          = EXCLUDED.source,
        synced_at       = NOW()
    `, values);
  } catch (err) {
    console.warn('[readiness autoSync] error', err);
  } finally {
    client.release();
  }
}

// -------------------------------------------------------------------------

/**
 * GET /api/analytics/readiness?days=30|60|90
 *
 * Always fetches 60 extra days of history beyond the requested range so that
 * the Normal Zone (60-day rolling avg ± 1σ) can be computed even when the
 * user selects a short display window.
 */
export async function GET(req: Request) {
  // Auto-sync wellness data if stale — but AFTER the response is sent, so the
  // chart never blocks on the external intervals.icu call. The client's
  // stale-while-revalidate refetch picks up the fresh rows on its next pass.
  after(() => autoSyncWellness());

  const { searchParams } = new URL(req.url);
  const displayDays = Math.min(365, Math.max(7, Number(searchParams.get('days') ?? '30')));
  const fetchDays   = displayDays + 60; // extra history for zone baseline

  const client = await pool.connect();
  try {
    const res = await client.query<{
      date:            string;
      hrv_rmssd:       number | null;
      resting_hr:      number | null;
      sleep_score:     number | null;
      readiness_score: number | null;
    }>(`
      SELECT
        TO_CHAR(date, 'YYYY-MM-DD') AS date,
        hrv_rmssd,
        resting_hr,
        sleep_score,
        readiness_score
      FROM daily_wellness
      WHERE date >= CURRENT_DATE - INTERVAL '1 day' * $1
      ORDER BY date ASC
    `, [fetchDays]);

    const allRows = res.rows;

    // Build display window (last displayDays rows only)
    const cutoff    = new Date();
    cutoff.setDate(cutoff.getDate() - displayDays);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    // Compute 60-day baseline zone for HRV from all fetched data
    const hrvBaseline = allRows
      .map(r => r.hrv_rmssd)
      .filter((v): v is number => v !== null && isFinite(v));

    let zone: ReadinessResponse['zone'] = null;
    let hrvAvg = 0, hrvSd = 0;
    if (hrvBaseline.length >= 7) {
      hrvAvg = hrvBaseline.reduce((a, b) => a + b, 0) / hrvBaseline.length;
      hrvSd  = Math.sqrt(hrvBaseline.reduce((a, b) => a + (b - hrvAvg) ** 2, 0) / hrvBaseline.length);
      zone = {
        avg:   Math.round(hrvAvg * 10) / 10,
        sd:    Math.round(hrvSd  * 10) / 10,
        upper: Math.round((hrvAvg + hrvSd) * 10) / 10,
        lower: Math.round((hrvAvg - hrvSd) * 10) / 10,
      };
    }

    // RHR baseline (lower is better)
    const rhrBaseline = allRows
      .map(r => r.resting_hr)
      .filter((v): v is number => v !== null && isFinite(v));
    let rhrAvg = 0, rhrSd = 0;
    if (rhrBaseline.length >= 7) {
      rhrAvg = rhrBaseline.reduce((a, b) => a + b, 0) / rhrBaseline.length;
      rhrSd  = Math.sqrt(rhrBaseline.reduce((a, b) => a + (b - rhrAvg) ** 2, 0) / rhrBaseline.length);
    }

    const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

    /**
     * Compute objective readiness score (0-100) from HRV, sleep, and RHR.
     * Weights redistribute when components are missing. Requires HRV.
     */
    function computeReadiness(
      hrv: number | null,
      sleep: number | null,
      rhr: number | null,
    ): number | null {
      if (hrv === null || hrvSd === 0) return null;
      // HRV: z-score → 50 at baseline, +25 per +1σ, clamped 0-100
      const hrvScore = clamp(50 + ((hrv - hrvAvg) / hrvSd) * 25);
      const components: { score: number; weight: number }[] = [{ score: hrvScore, weight: 0.5 }];
      if (sleep !== null) components.push({ score: clamp(sleep), weight: 0.3 });
      if (rhr !== null && rhrSd > 0) {
        // Lower RHR = better; invert sign on z-score
        const rhrScore = clamp(50 + ((rhrAvg - rhr) / rhrSd) * 25);
        components.push({ score: rhrScore, weight: 0.2 });
      }
      const totalW = components.reduce((s, c) => s + c.weight, 0);
      const score  = components.reduce((s, c) => s + c.score * c.weight, 0) / totalW;
      return Math.round(score);
    }

    const points: ReadinessPoint[] = allRows
      .filter(r => r.date >= cutoffStr)
      .map(r => ({
        date:            r.date,
        hrv:             r.hrv_rmssd !== null ? Math.round(r.hrv_rmssd * 10) / 10 : null,
        sleep_score:     r.sleep_score,
        readiness_score: r.readiness_score ?? computeReadiness(r.hrv_rmssd, r.sleep_score, r.resting_hr),
        resting_hr:      r.resting_hr,
      }));

    // 7-day recent average (from display window)
    const recent7 = points
      .slice(-7)
      .map(p => p.hrv)
      .filter((v): v is number => v !== null);
    const recent_avg = recent7.length
      ? Math.round((recent7.reduce((a, b) => a + b, 0) / recent7.length) * 10) / 10
      : null;

    // Fatigue alert: 3+ consecutive days below lower zone
    let fatigue_alert = false;
    if (zone) {
      let consecutive = 0;
      for (const p of [...points].reverse()) {
        if (p.hrv === null) break;
        if (p.hrv < zone.lower) { consecutive++; } else { break; }
      }
      fatigue_alert = consecutive >= 3;
    }

    return Response.json({ points, zone, recent_avg, fatigue_alert } satisfies ReadinessResponse);
  } catch (err) {
    console.error('[readiness GET]', err);
    return Response.json({ points: [], zone: null, recent_avg: null, fatigue_alert: false, error: String(err) });
  } finally {
    client.release();
  }
}
