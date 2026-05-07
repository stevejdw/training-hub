import pool from '@/lib/db';
import { getProfile } from '@/lib/profile';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

const CYCLING = ['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide'];

function toFloatOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function toIntOrNull(v: unknown): number | null {
  const n = toFloatOrNull(v);
  return n !== null ? Math.round(n) : null;
}

/**
 * If the newest daily_wellness row is older than 1 day, fetch the last 7 days
 * from intervals.icu and upsert them. This keeps wellness data fresh without
 * requiring the user to manually sync every day.
 */
async function autoSyncWellness(): Promise<void> {
  const profile = await getProfile();
  const athleteId = profile.intervals_athlete_id?.trim();
  const apiKey    = profile.intervals_api_key?.trim();
  if (!athleteId || !apiKey) return; // no creds configured

  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT MAX(date) AS newest FROM daily_wellness`);
    const newest: string | null = res.rows[0]?.newest ?? null;

    // If newest data is less than 1 day old, no sync needed
    if (newest) {
      const newestDate = new Date(newest + 'T00:00:00Z');
      const now = new Date();
      const diffMs = now.getTime() - newestDate.getTime();
      if (diffMs < 24 * 60 * 60 * 1000) return; // less than 1 day old
    }

    // Fetch last 7 days from intervals.icu
    const newestDate = new Date();
    const oldestDate = new Date(newestDate);
    oldestDate.setDate(oldestDate.getDate() - 7);

    const fmt = (d: Date) => d.toISOString().split('T')[0];
    const url = `https://intervals.icu/api/v1/athlete/${athleteId}/wellness?oldest=${fmt(oldestDate)}&newest=${fmt(newestDate)}`;

    const auth = Buffer.from(`API_KEY:${apiKey}`).toString('base64');

    const resFetch = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
    });

    if (!resFetch.ok) {
      console.warn('[autoSync] intervals.icu fetch failed', resFetch.status);
      return;
    }

    const wellnessRows = await resFetch.json() as Record<string, unknown>[];
    if (!Array.isArray(wellnessRows) || wellnessRows.length === 0) return;

    for (const row of wellnessRows) {
      const date = row.id as string; // intervals.icu uses 'id' for the date field
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
        toIntOrNull(row.readiness    ?? row.readinessScore ?? row.score ?? row.readiness_score),
        toIntOrNull(row.sleepSecs    ?? row.sleep_secs),
      ]);
    }
  } catch (err) {
    console.warn('[autoSync] error', err);
  } finally {
    client.release();
  }
}

export async function GET(_req: NextRequest) {
  // Auto-sync wellness data if stale (non-blocking — fire and forget)
  autoSyncWellness().catch(() => {});

  const profile = await getProfile();
  const intervalsConfigured = !!(profile.intervals_athlete_id?.trim());

  const client = await pool.connect();
  try {
    const [tssRes, wellnessRes] = await Promise.all([
      client.query(`
        SELECT
          start_date::date::text AS date,
          COALESCE(SUM(tss), 0)::float AS tss
        FROM activities
        WHERE sport_type = ANY($1::text[])
          AND tss IS NOT NULL
          AND start_date >= CURRENT_DATE - INTERVAL '60 days'
        GROUP BY start_date::date
        ORDER BY date ASC
      `, [CYCLING]),

      client.query(`
        SELECT
          TO_CHAR(date, 'YYYY-MM-DD') AS date,
          hrv_rmssd,
          resting_hr,
          sleep_score
        FROM daily_wellness
        WHERE date >= CURRENT_DATE - INTERVAL '60 days'
        ORDER BY date ASC
      `),
    ]);

    const tssMap: Record<string, number> = {};
    for (const r of tssRes.rows) tssMap[r.date] = Number(r.tss);

    // Build wellness maps for each metric
    const hrvMap: Record<string, number> = {};
    const rhrMap: Record<string, number> = {};
    const sleepMap: Record<string, number> = {};
    for (const r of wellnessRes.rows) {
      if (r.hrv_rmssd   != null) hrvMap[r.date]   = Number(r.hrv_rmssd);
      if (r.resting_hr  != null) rhrMap[r.date]   = Number(r.resting_hr);
      if (r.sleep_score != null) sleepMap[r.date] = Number(r.sleep_score);
    }

    // Choose the primary recovery metric: HRV > resting_hr > sleep_score
    const hrvCount = Object.keys(hrvMap).length;
    const rhrCount = Object.keys(rhrMap).length;
    const sleepCount = Object.keys(sleepMap).length;

    let metricKey: 'hrv' | 'rhr' | 'sleep';
    let metricLabel: string;
    let metricUnit: string;
    // For resting_hr, lower = better (invert for status logic)
    let invertedMetric = false;

    if (hrvCount >= 3) {
      metricKey = 'hrv';
      metricLabel = 'HRV';
      metricUnit = 'ms';
    } else if (rhrCount >= 3) {
      metricKey = 'rhr';
      metricLabel = 'Resting HR';
      metricUnit = 'bpm';
      invertedMetric = true; // higher resting HR = worse recovery
    } else if (sleepCount >= 3) {
      metricKey = 'sleep';
      metricLabel = 'Sleep Score';
      metricUnit = '';
    } else {
      // No wellness metric available
      return Response.json({ data: [], hrvBaseline: null, intervalsConfigured, metricKey: null, metricLabel: null, metricUnit: null });
    }

    const primaryMap = metricKey === 'hrv' ? hrvMap : metricKey === 'rhr' ? rhrMap : sleepMap;

    // Union all dates
    const allDates = [...new Set([...Object.keys(tssMap), ...Object.keys(primaryMap)])].sort();

    // Compute 60-day baseline for chosen metric
    const metricValues = Object.values(primaryMap).filter(v => v > 0);
    let hrvBaseline: { mean: number; stdDev: number } | null = null;
    if (metricValues.length >= 3) {
      const mean = metricValues.reduce((s, v) => s + v, 0) / metricValues.length;
      const variance = metricValues.reduce((s, v) => s + (v - mean) ** 2, 0) / metricValues.length;
      const stdDev = Math.sqrt(variance);
      hrvBaseline = {
        mean:   Math.round(mean * 10) / 10,
        stdDev: Math.round(stdDev * 10) / 10,
      };
    }

    const data = allDates.map((date, i) => {
      const tss     = tssMap[date] ?? null;
      const metric  = primaryMap[date] ?? null;
      const prevDate = i > 0 ? allDates[i - 1] : null;
      const prevTss  = prevDate ? (tssMap[prevDate] ?? 0) : 0;

      let status: 'green' | 'warning' | 'neutral' | null = null;
      if (metric != null && hrvBaseline) {
        const { mean, stdDev } = hrvBaseline;
        const inRange = metric >= mean - stdDev && metric <= mean + stdDev;
        // For inverted metrics (resting HR), high value = bad; for normal (HRV, sleep), low = bad
        const warnCondition = invertedMetric
          ? metric > mean + stdDev && prevTss > 80   // high resting HR after hard day
          : metric < mean - stdDev && prevTss > 80;  // low HRV/sleep after hard day

        if (inRange) {
          status = 'green';
        } else if (warnCondition) {
          status = 'warning';
        } else {
          status = 'neutral';
        }
      }

      return { date, tss, hrv: metric, status };
    });

    return Response.json({ data, hrvBaseline, intervalsConfigured, metricKey, metricLabel, metricUnit });
  } catch (err) {
    console.error('[readiness-response]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
