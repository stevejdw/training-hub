import pool from '@/lib/db';

export const runtime = 'nodejs';

// Returns selectable eFTP estimates from recent rides:
// best NP from rides 18-25 min (×0.95) and 45-75 min (raw NP ≈ 60min FTP)
export async function GET() {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT
        name,
        TO_CHAR(start_date AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD') AS date,
        ROUND(moving_time / 60.0, 0) AS duration_min,
        ROUND(normalized_power) AS np,
        CASE
          WHEN moving_time BETWEEN 1080 AND 1500 THEN ROUND(normalized_power * 0.95)
          ELSE ROUND(normalized_power)
        END AS eftp_estimate
      FROM activities
      WHERE normalized_power IS NOT NULL
        AND moving_time >= 1080
        AND sport_type IN ('Ride', 'GravelRide', 'MountainBikeRide')
        AND start_date >= NOW() - INTERVAL '90 days'
      ORDER BY eftp_estimate DESC
      LIMIT 10
    `);

    return Response.json(res.rows);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
