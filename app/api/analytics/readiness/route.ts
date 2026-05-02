import pool from '@/lib/db';

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

/**
 * GET /api/analytics/readiness?days=30|60|90
 *
 * Always fetches 60 extra days of history beyond the requested range so that
 * the Normal Zone (60-day rolling avg ± 1σ) can be computed even when the
 * user selects a short display window.
 */
export async function GET(req: Request) {
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

    const points: ReadinessPoint[] = allRows
      .filter(r => r.date >= cutoffStr)
      .map(r => ({
        date:            r.date,
        hrv:             r.hrv_rmssd !== null ? Math.round(r.hrv_rmssd * 10) / 10 : null,
        sleep_score:     r.sleep_score,
        readiness_score: r.readiness_score,
        resting_hr:      r.resting_hr,
      }));

    // Compute 60-day baseline zone from all fetched data (including the extra window)
    const hrvBaseline = allRows
      .map(r => r.hrv_rmssd)
      .filter((v): v is number => v !== null && isFinite(v));

    let zone: ReadinessResponse['zone'] = null;
    if (hrvBaseline.length >= 7) {
      const avg  = hrvBaseline.reduce((a, b) => a + b, 0) / hrvBaseline.length;
      const variance = hrvBaseline.reduce((a, b) => a + (b - avg) ** 2, 0) / hrvBaseline.length;
      const sd   = Math.sqrt(variance);
      zone = {
        avg:   Math.round(avg  * 10) / 10,
        sd:    Math.round(sd   * 10) / 10,
        upper: Math.round((avg + sd) * 10) / 10,
        lower: Math.round((avg - sd) * 10) / 10,
      };
    }

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
