import pool from '@/lib/db';
import { getStravaToken, ensureSegmentTables } from '@/lib/strava-sync';

export const runtime = 'nodejs';

export async function GET() {
  await ensureSegmentTables();
  const client = await pool.connect();
  try {
    // Return cached if we have some
    const cached = await client.query(`SELECT * FROM starred_segments ORDER BY name`);
    if (cached.rows.length > 0) {
      return Response.json(cached.rows);
    }

    // Fetch from Strava and cache
    const token = await getStravaToken();
    const res = await fetch(
      'https://www.strava.com/api/v3/segments/starred?per_page=200',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Strava starred segments failed: ${res.status}`);
    const segs = await res.json() as Record<string, unknown>[];

    for (const s of segs) {
      await client.query(`
        INSERT INTO starred_segments (id, name, distance, avg_grade, city, country, synced_at)
        VALUES ($1,$2,$3,$4,$5,$6,NOW())
        ON CONFLICT (id) DO UPDATE SET
          name=EXCLUDED.name, synced_at=NOW()
      `, [s.id, s.name, s.distance, s.average_grade, s.city, s.country]);
    }

    return Response.json(segs.map(s => ({
      id: s.id, name: s.name, distance: s.distance,
      avg_grade: s.average_grade, city: s.city, country: s.country,
    })));
  } finally {
    client.release();
  }
}

// Force re-sync starred segments from Strava
export async function POST() {
  await ensureSegmentTables();
  const client = await pool.connect();
  try {
    const token = await getStravaToken();
    const res = await fetch(
      'https://www.strava.com/api/v3/segments/starred?per_page=200',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Strava starred segments failed: ${res.status}`);
    const segs = await res.json() as Record<string, unknown>[];

    await client.query(`DELETE FROM starred_segments`);
    for (const s of segs) {
      await client.query(`
        INSERT INTO starred_segments (id, name, distance, avg_grade, city, country, synced_at)
        VALUES ($1,$2,$3,$4,$5,$6,NOW())
      `, [s.id, s.name, s.distance, s.average_grade, s.city, s.country]);
    }

    return Response.json({ synced: segs.length });
  } finally {
    client.release();
  }
}
