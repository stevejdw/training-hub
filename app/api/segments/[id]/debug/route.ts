import pool from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const client = await pool.connect();

  try {
    const [
      bySegmentId,
      nullSegmentId,
      sampleRows,
      starredRow,
      activitiesTotal,
      activitiesUnsynced,
    ] = await Promise.all([
      // How many efforts WHERE segment_id = id
      client.query(`SELECT COUNT(*) AS n FROM segment_efforts WHERE segment_id = $1`, [id]),
      // How many efforts with NULL segment_id
      client.query(`SELECT COUNT(*) AS n FROM segment_efforts WHERE segment_id IS NULL`),
      // Sample of 10 rows so we can see what segment_ids look like
      client.query(`SELECT id, activity_id, segment_id, name, start_date FROM segment_efforts ORDER BY start_date DESC LIMIT 10`),
      // The starred segment row
      client.query(`SELECT id, name, all_efforts_synced_at FROM starred_segments WHERE id = $1`, [id]),
      // Total activities
      client.query(`SELECT COUNT(*) AS n FROM activities`),
      // Unsynced activities
      client.query(`SELECT COUNT(*) AS n FROM activities WHERE segments_synced_at IS NULL`),
    ]);

    return Response.json({
      queried_id: id,
      queried_id_type: typeof id,
      matching_efforts: Number(bySegmentId.rows[0].n),
      null_segment_id_efforts: Number(nullSegmentId.rows[0].n),
      sample_efforts: sampleRows.rows,
      starred_segment: starredRow.rows[0] ?? null,
      total_activities: Number(activitiesTotal.rows[0].n),
      unsynced_activities: Number(activitiesUnsynced.rows[0].n),
    });
  } finally {
    client.release();
  }
}
