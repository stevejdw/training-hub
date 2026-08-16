import pool from '@/lib/db';
import { getStravaToken } from '@/lib/strava-sync';
import { getDeletionFlags } from '@/lib/activity-delete';
import { stravaIdFor } from '@/lib/activity-identity';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Don't pull back streams the user deleted in the app.
  const flagClient = await pool.connect();
  let flags, stravaId: number | null;
  try {
    flags = await getDeletionFlags(flagClient, Number(id));
    // The internal id is not Strava's id for Garmin-sourced rides.
    stravaId = await stravaIdFor(flagClient, Number(id));
  } finally {
    flagClient.release();
  }
  if (flags.tombstoned) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }
  if (stravaId === null) {
    return Response.json(
      { error: 'This activity came from Garmin and has no Strava streams to fetch.' },
      { status: 409 }
    );
  }

  const token = await getStravaToken();

  const streamRes = await fetch(
    `https://www.strava.com/api/v3/activities/${stravaId}/streams?keys=watts,heartrate&key_by_type=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!streamRes.ok) {
    return Response.json({ error: 'Strava stream fetch failed' }, { status: 502 });
  }

  const streamData = await streamRes.json() as Record<string, unknown>;
  const availableKeys = Object.keys(streamData);
  const watts = flags.powerDeleted ? null : (streamData?.watts     as { data: number[] } | null)?.data ?? null;
  const hr    = flags.hrDeleted    ? null : (streamData?.heartrate as { data: number[] } | null)?.data ?? null;

  if (!watts && !hr) {
    return Response.json({
      ok: false,
      message: `No stream data returned by Strava. Available keys: ${availableKeys.join(', ') || 'none'}`,
    });
  }

  if (!hr) {
    return Response.json({
      ok: false,
      has_watts: !!watts,
      has_hr: false,
      message: `Strava returned no heartrate stream. Available keys: ${availableKeys.join(', ')}`,
    });
  }

  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE activity_streams ADD COLUMN IF NOT EXISTS hr INT[]`).catch(() => {});
    await client.query(`
      INSERT INTO activity_streams (activity_id, watts, hr)
      VALUES ($1, $2, $3)
      ON CONFLICT (activity_id) DO UPDATE
        SET watts = COALESCE(EXCLUDED.watts, activity_streams.watts),
            hr    = COALESCE(EXCLUDED.hr,    activity_streams.hr)
    `, [id, watts, hr]);
  } finally {
    client.release();
  }

  return Response.json({ ok: true, has_watts: !!watts, has_hr: !!hr });
}
