import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import { getProfile, effectiveFtp } from '@/lib/profile';
import { powerZoneDefs, hrZoneDefs, type ZoneDef, type ZoneResult } from '@/lib/zones';

export const runtime = 'nodejs';

/** Stream columns this route is allowed to bucket. Interpolated into SQL, so
 *  it must stay a closed set. */
type StreamColumn = 'watts' | 'hr';

/**
 * Count seconds per zone inside Postgres.
 *
 * Mirrors calcZoneTime() in lib/zones.ts: samples at or below zero are ignored,
 * and a sample lands in the highest-indexed zone whose bounds contain it — which
 * is MAX(i) here, matching that function's reverse scan. Returning ~7 counts
 * instead of a full 1 Hz array is the entire point: this route used to pull
 * ~108 KB out of the database per activity view to produce a histogram.
 */
async function zoneSeconds(
  client: PoolClient,
  activityId: string,
  column: StreamColumn,
  zones: ZoneDef[],
): Promise<number[]> {
  const mins = zones.map(z => z.min);
  const maxs = zones.map(z => z.max);

  const res = await client.query<{ zi: number; seconds: string }>(
    `SELECT z.zi, COUNT(*)::bigint AS seconds
       FROM activity_streams s,
            unnest(s.${column}) AS v
       CROSS JOIN LATERAL (
         SELECT MAX(i) AS zi
           FROM generate_subscripts($2::float8[], 1) AS i
          WHERE v >= ($2::float8[])[i]
            AND (($3::float8[])[i] IS NULL OR v <= ($3::float8[])[i])
       ) z
      WHERE s.activity_id = $1
        AND v > 0
        AND z.zi IS NOT NULL
      GROUP BY z.zi`,
    [activityId, mins, maxs],
  );

  const counts = new Array<number>(zones.length).fill(0);
  for (const row of res.rows) {
    counts[row.zi - 1] = Number(row.seconds); // generate_subscripts is 1-based
  }
  return counts;
}

/** Attach seconds/pct to zone defs exactly as calcZoneTime() did. */
function toZoneResults(zones: ZoneDef[], counts: number[]): ZoneResult[] {
  const total = counts.reduce((s, n) => s + n, 0) || 1;
  return zones.map((z, i) => ({
    ...z,
    seconds: counts[i],
    pct: Math.round((counts[i] / total) * 1000) / 10,
  }));
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const [profile, client] = await Promise.all([getProfile(), pool.connect()]);
  try {
    const ftp = effectiveFtp(profile);

    const meta = await client.query<{ has_power: boolean; has_hr: boolean }>(
      `SELECT COALESCE(array_length(watts, 1), 0) > 0 AS has_power,
              COALESCE(array_length(hr, 1), 0) > 0    AS has_hr
         FROM activity_streams
        WHERE activity_id = $1`,
      [id],
    );

    if (meta.rows.length === 0) {
      return Response.json({
        power: null,
        hr: null,
        has_hr_stream: false,
        ftp,
        max_hr: profile.max_hr,
      });
    }

    const { has_power, has_hr } = meta.rows[0];

    const powerZones = powerZoneDefs(ftp, profile.power_zones_auto ? null : profile.power_zone_boundaries);
    const hrZones    = profile.max_hr
      ? hrZoneDefs(profile.max_hr, profile.hr_zones_auto ? null : profile.hr_zone_boundaries)
      : null;

    const [powerCounts, hrCounts] = await Promise.all([
      has_power ? zoneSeconds(client, id, 'watts', powerZones) : null,
      has_hr && hrZones ? zoneSeconds(client, id, 'hr', hrZones) : null,
    ]);

    return Response.json({
      power: powerCounts ? toZoneResults(powerZones, powerCounts) : null,
      hr:    hrCounts && hrZones ? toZoneResults(hrZones, hrCounts) : null,
      has_hr_stream: has_hr,
      ftp,
      max_hr: profile.max_hr,
    });
  } finally {
    client.release();
  }
}
