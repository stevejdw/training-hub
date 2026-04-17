import pool from '@/lib/db';
import { getProfile, effectiveFtp } from '@/lib/profile';
import { powerZoneDefs, hrZoneDefs, calcZoneTime } from '@/lib/zones';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const [profile, client] = await Promise.all([getProfile(), pool.connect()]);
  try {
    const res = await client.query(
      `SELECT watts, hr FROM activity_streams WHERE activity_id = $1`,
      [id]
    );

    if (res.rows.length === 0) {
      return Response.json({ power: null, hr: null });
    }

    const { watts, hr } = res.rows[0] as { watts: number[] | null; hr: number[] | null };
    const ftp = effectiveFtp(profile);

    const powerZones = powerZoneDefs(ftp, profile.power_zones_auto ? null : profile.power_zone_boundaries);
    const hrZones    = profile.max_hr
      ? hrZoneDefs(profile.max_hr, profile.hr_zones_auto ? null : profile.hr_zone_boundaries)
      : null;

    return Response.json({
      power: watts ? calcZoneTime(watts, powerZones) : null,
      hr:    (hr && hrZones) ? calcZoneTime(hr, hrZones) : null,
      ftp,
      max_hr: profile.max_hr,
    });
  } finally {
    client.release();
  }
}
