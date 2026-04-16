import pool from './db';
import { calculateFitness } from './fitness';
import { getProfile, effectiveFtp } from './profile';

export interface Activity {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  total_elevation_gain: number;
  average_watts: number | null;
  weighted_average_watts: number | null;
  max_watts: number | null;
  kilojoules: number | null;
  average_heartrate: number | null;
  max_heartrate: number | null;
  suffer_score: number | null;
  trainer: boolean;
  average_speed: number | null;
  tss: number | null;
  intensity_factor: number | null;
  normalized_power: number | null;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}m` : `${m}m`;
}

function formatDistance(meters: number): string {
  return (meters / 1000).toFixed(1) + 'km';
}

export async function buildTrainingContext(): Promise<string> {
  const [client, profile] = await Promise.all([pool.connect(), getProfile()]);
  const FTP = effectiveFtp(profile);
  try {
    // 1. Recent 90 days — full detail
    const recentResult = await client.query<Activity>(`
      SELECT * FROM activities
      WHERE start_date >= NOW() - INTERVAL '90 days'
      ORDER BY start_date DESC
    `);
    const recent = recentResult.rows;

    // 2. Weekly summaries for the past year
    const weeklySummaryResult = await client.query(`
      SELECT
        date_trunc('week', start_date)::date AS week_start,
        COUNT(*) AS activity_count,
        ROUND(SUM(moving_time) / 3600.0, 1) AS hours,
        ROUND(SUM(COALESCE(tss, 0))::numeric, 0) AS total_tss,
        ROUND(SUM(distance / 1000.0)::numeric, 0) AS total_km,
        ROUND(SUM(total_elevation_gain)::numeric, 0) AS total_elevation,
        STRING_AGG(DISTINCT sport_type, ', ') AS sports
      FROM activities
      WHERE start_date >= NOW() - INTERVAL '52 weeks'
        AND start_date < NOW() - INTERVAL '90 days'
      GROUP BY week_start
      ORDER BY week_start DESC
    `);
    const weeklySummaries = weeklySummaryResult.rows;

    // 3. All-time daily TSS for CTL/ATL/TSB
    const dailyTssResult = await client.query(`
      SELECT
        TO_CHAR(start_date AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD') AS date,
        SUM(COALESCE(tss, 0)) AS tss
      FROM activities
      GROUP BY 1
      ORDER BY 1
    `);
    const dailyTss = dailyTssResult.rows.map((r) => ({
      date: String(r.date),
      tss: Number(r.tss),
    }));
    const fitness = calculateFitness(dailyTss);

    // 4. Laps for the most recent 10 activities that have lap data
    const recentIds = recent.slice(0, 20).map(a => a.id);
    const lapsResult: { rows: Record<string, unknown>[] } = recentIds.length > 0 ? await client.query(`
      SELECT l.activity_id, l.lap_index, l.name,
             l.moving_time, l.distance,
             l.average_watts, l.normalized_power,
             l.average_heartrate, l.max_heartrate,
             l.total_elevation_gain
      FROM laps l
      WHERE l.activity_id = ANY($1::bigint[])
      ORDER BY l.activity_id DESC, l.lap_index ASC
    `, [recentIds]) : { rows: [] };

    // Group laps by activity_id — use string keys to avoid bigint/number mismatch
    const lapsByActivity = new Map<string, Record<string, unknown>[]>();
    for (const lap of lapsResult.rows) {
      const key = String(lap.activity_id);
      if (!lapsByActivity.has(key)) lapsByActivity.set(key, []);
      lapsByActivity.get(key)!.push(lap);
    }

    // 5. Annual totals
    const annualResult = await client.query(`
      SELECT
        EXTRACT(YEAR FROM start_date) AS year,
        COUNT(*) AS activities,
        ROUND(SUM(moving_time) / 3600.0, 0) AS hours,
        ROUND(SUM(distance / 1000.0)::numeric, 0) AS km,
        ROUND(SUM(total_elevation_gain)::numeric, 0) AS elevation
      FROM activities
      GROUP BY year
      ORDER BY year DESC
      LIMIT 5
    `);

    // Build context string
    const today = new Date();

    let ctx = `# Athlete Training Context
Generated: ${today.toISOString().slice(0, 10)}

## Athlete Profile
- Name: ${profile.name}
- FTP: ${FTP}W${profile.use_eftp && profile.eftp ? ` (eFTP-derived, raw FTP ${profile.ftp}W)` : ''}
${profile.weight_kg ? `- Weight: ${profile.weight_kg}kg\n` : ''}\
${profile.training_goals ? `- Training Goals: ${profile.training_goals}\n` : ''}\
${profile.events.length > 0 ? profile.events.map(e => {
  const days = Math.ceil((new Date(e.date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return `- Event: ${e.name} on ${e.date} (${days} days away)${e.goal ? ` — Goal: ${e.goal}` : ''}`;
}).join('\n') + '\n' : ''}
## Current Fitness (CTL/ATL/TSB)
- CTL (fitness, 42-day): ${fitness.ctl}
- ATL (fatigue, 7-day): ${fitness.atl}
- TSB (form): ${fitness.tsb} ${fitness.tsb >= 5 ? '(fresh)' : fitness.tsb <= -20 ? '(fatigued)' : '(neutral)'}

## Annual Training Volumes
`;
    for (const yr of annualResult.rows) {
      ctx += `- ${yr.year}: ${yr.activities} activities, ${yr.hours}h, ${yr.km}km, ${yr.elevation}m gain\n`;
    }

    ctx += `\n## Weekly Summaries (last 52 weeks, excluding recent 90 days)\n`;
    for (const w of weeklySummaries) {
      ctx += `- Week of ${w.week_start}: ${w.hours}h, TSS ${w.total_tss}, ${w.total_km}km, ${w.total_elevation}m (${w.sports})\n`;
    }

    ctx += `\n## Recent Activities (last 90 days, ${recent.length} activities)\n`;
    for (const a of recent) {
      const date = new Date(a.start_date).toISOString().slice(0, 10);
      const parts = [
        `${date} [${a.sport_type}] "${a.name}"`,
        formatDuration(a.moving_time),
        a.distance > 0 ? formatDistance(a.distance) : null,
        a.total_elevation_gain > 0 ? `${Math.round(a.total_elevation_gain)}m gain` : null,
        a.normalized_power ? `NP ${Math.round(a.normalized_power)}W` : a.average_watts ? `avg ${Math.round(a.average_watts)}W` : null,
        a.tss ? `TSS ${Math.round(a.tss)}` : null,
        a.intensity_factor ? `IF ${a.intensity_factor.toFixed(2)}` : null,
        a.average_heartrate ? `HR ${Math.round(a.average_heartrate)}` : null,
        a.trainer ? '[indoor]' : null,
      ].filter(Boolean);
      ctx += `- ${parts.join(' | ')}\n`;

      const laps = lapsByActivity.get(String(a.id));
      if (laps && laps.length > 0) {
        ctx += `  Laps:\n`;
        for (const lap of laps) {
          const idx = Number(lap.lap_index);
          const name = String(lap.name ?? '');
          const dist = Number(lap.distance ?? 0);
          const np = lap.normalized_power != null ? Number(lap.normalized_power) : null;
          const avgW = lap.average_watts != null ? Number(lap.average_watts) : null;
          const avgHr = lap.average_heartrate != null ? Number(lap.average_heartrate) : null;
          const maxHr = lap.max_heartrate != null ? Number(lap.max_heartrate) : null;
          const defaultName = `Lap ${idx + 1}`;
          const lapParts = [
            defaultName,
            name && name !== defaultName ? `"${name}"` : null,
            formatDuration(Number(lap.moving_time ?? 0)),
            dist > 0 ? formatDistance(dist) : null,
            np ? `NP ${Math.round(np)}W` : avgW ? `avg ${Math.round(avgW)}W` : null,
            avgHr ? `HR ${Math.round(avgHr)}` : null,
            maxHr ? `maxHR ${Math.round(maxHr)}` : null,
          ].filter(Boolean);
          ctx += `    - ${lapParts.join(' | ')}\n`;
        }
      }
    }

    return ctx;
  } finally {
    client.release();
  }
}
