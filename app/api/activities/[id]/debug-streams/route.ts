import { getStravaToken } from '@/lib/strava-sync';

import pool from '@/lib/db';
import { stravaIdFor } from '@/lib/activity-identity';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Garmin-sourced rides have no Strava id; calling Strava with the internal
  // surrogate would just 404.
  const idClient = await pool.connect();
  let stravaId: number | null;
  try { stravaId = await stravaIdFor(idClient, Number(id)); } finally { idClient.release(); }
  if (stravaId === null) {
    return Response.json({ error: 'No Strava counterpart for this activity' }, { status: 409 });
  }
  const token = await getStravaToken();

  const res = await fetch(
    `https://www.strava.com/api/v3/activities/${stravaId}/streams?keys=watts,heartrate,time&key_by_type=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  const body = await res.json() as Record<string, unknown>;

  const summary = {
    status: res.status,
    keys_returned: Object.keys(body),
    has_watts: 'watts' in body,
    has_heartrate: 'heartrate' in body,
    watts_length: (body.watts as { data: unknown[] } | null)?.data?.length ?? null,
    hr_length: (body.heartrate as { data: unknown[] } | null)?.data?.length ?? null,
    hr_sample: (body.heartrate as { data: number[] } | null)?.data?.slice(0, 5) ?? null,
  };

  return Response.json(summary);
}
