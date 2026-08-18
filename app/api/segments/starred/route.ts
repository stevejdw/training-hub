import pool from '@/lib/db';
import { getStravaToken, ensureSegmentTables } from '@/lib/strava-sync';
import { getSyncSources, skippedReason } from '@/lib/sync-sources';

export const runtime = 'nodejs';
export const maxDuration = 60;

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
      const latlng = s.start_latlng as [number, number] | null;
      await client.query(`
        INSERT INTO starred_segments (id, name, distance, avg_grade, city, country, start_lat, start_lng, synced_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
        ON CONFLICT (id) DO UPDATE SET
          name=EXCLUDED.name, start_lat=EXCLUDED.start_lat, start_lng=EXCLUDED.start_lng, synced_at=NOW()
      `, [s.id, s.name, s.distance, s.average_grade, s.city, s.country,
          latlng?.[0] ?? null, latlng?.[1] ?? null]);
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
  // These backfills read from Strava's API. With Garmin as the primary
  // source they have nothing to add — Garmin's own details sync fills the
  // same gaps — and running them only burns Strava rate limit.
  const { primary } = await getSyncSources();
  if (primary !== 'strava') {
    return Response.json({ processed: 0, remaining: 0, skipped: skippedReason(primary, 'Strava starred segments backfill') });
  }

  try {
    await ensureSegmentTables();
  } catch (err) {
    return Response.json({ error: 'ensureSegmentTables failed', detail: String(err) }, { status: 500 });
  }

  const client = await pool.connect();
  try {
    let token: string;
    try {
      token = await getStravaToken();
    } catch (err) {
      return Response.json({ error: 'Strava token refresh failed', detail: String(err) }, { status: 500 });
    }

    const res = await fetch(
      'https://www.strava.com/api/v3/segments/starred?per_page=200',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return Response.json({ error: `Strava starred segments returned ${res.status}`, body: body.slice(0, 500) }, { status: 502 });
    }

    const segs = await res.json() as Record<string, unknown>[];

    // UPSERT rather than DELETE+INSERT so a partial failure doesn't wipe the table
    for (const s of segs) {
      const latlng = s.start_latlng as [number, number] | null;
      await client.query(`
        INSERT INTO starred_segments (id, name, distance, avg_grade, city, country, start_lat, start_lng, synced_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
        ON CONFLICT (id) DO UPDATE SET
          name=EXCLUDED.name, distance=EXCLUDED.distance, avg_grade=EXCLUDED.avg_grade,
          city=EXCLUDED.city, country=EXCLUDED.country,
          start_lat=EXCLUDED.start_lat, start_lng=EXCLUDED.start_lng, synced_at=NOW()
      `, [s.id, s.name, s.distance, s.average_grade, s.city, s.country,
          latlng?.[0] ?? null, latlng?.[1] ?? null]);
    }

    // Remove any starred_segments no longer in Strava's list (user unstarred them)
    const ids = segs.map(s => s.id as number);
    if (ids.length > 0) {
      await client.query(`DELETE FROM starred_segments WHERE id <> ALL($1::bigint[])`, [ids]);
    }

    return Response.json({ synced: segs.length });
  } catch (err) {
    console.error('[starred POST]', err);
    return Response.json({ error: 'unexpected', detail: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
