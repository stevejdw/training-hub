import pool from '@/lib/db';
import { buildTrainingContext } from '@/lib/training-context';

export const runtime = 'nodejs';

export async function GET() {
  const client = await pool.connect();
  try {
    // Show the most recent 5 activity IDs and their lap counts
    const actResult = await client.query(`
      SELECT id, name, start_date
      FROM activities
      ORDER BY start_date DESC
      LIMIT 5
    `);

    const ids = actResult.rows.map(r => r.id);

    const lapCount = await client.query(`
      SELECT activity_id, COUNT(*) as lap_count
      FROM laps
      WHERE activity_id = ANY($1::bigint[])
      GROUP BY activity_id
    `, [ids]);

    const allLaps = await client.query(`
      SELECT activity_id, lap_index, moving_time, distance, average_watts, normalized_power, average_heartrate, max_heartrate
      FROM laps
      WHERE activity_id = ANY($1::bigint[])
      ORDER BY activity_id DESC, lap_index ASC
    `, [ids]);

    const diagnostics = [
      '=== DIAGNOSTICS ===',
      '',
      'Recent activity IDs (from pg, raw type):',
      actResult.rows.map(r => `  id=${r.id} (type=${typeof r.id}) name="${r.name}"`).join('\n'),
      '',
      'Lap counts per activity:',
      lapCount.rows.length === 0
        ? '  NO LAPS FOUND for these activity IDs'
        : lapCount.rows.map(r => `  activity_id=${r.activity_id} → ${r.lap_count} laps`).join('\n'),
      '',
      'Raw laps (first 20):',
      allLaps.rows.slice(0, 20).map(r =>
        `  act=${r.activity_id} lap=${r.lap_index} time=${r.moving_time} dist=${r.distance} avgW=${r.average_watts} NP=${r.normalized_power} HR=${r.average_heartrate}`
      ).join('\n') || '  NONE',
      '',
      '=== TRAINING CONTEXT ===',
      '',
    ].join('\n');

    const ctx = await buildTrainingContext();
    return new Response(diagnostics + ctx, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  } finally {
    client.release();
  }
}
