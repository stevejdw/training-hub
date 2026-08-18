/**
 * Trigger a GitHub Actions workflow from the app.
 *
 * Garmin's unofficial API has no webhook — push notifications exist only in the
 * official Developer Program, which is closed to individuals. But Garmin
 * auto-syncs to Strava, and Strava's webhook fires within seconds, so Strava
 * acts as a free doorbell: we ignore its data and use the notification to pull
 * the ride from Garmin immediately instead of waiting for the next poll.
 *
 * The Garmin client is Python-only (see .github/scripts/garmin_common.py), so
 * the actual fetch has to happen in Actions rather than here.
 *
 * Needs GH_DISPATCH_TOKEN: a fine-grained PAT scoped to this repository with
 * only `Actions: write`. It can do nothing else.
 */

const REPO = process.env.GITHUB_DISPATCH_REPO ?? 'stevejdw/training-hub';

export interface DispatchResult {
  ok: boolean;
  reason?: string;
}

export async function dispatchGarminSync(
  payload: Record<string, unknown> = {}
): Promise<DispatchResult> {
  const token = process.env.GH_DISPATCH_TOKEN?.trim();
  if (!token) {
    // Not configured — the scheduled safety-net poll still catches the ride.
    return { ok: false, reason: 'GH_DISPATCH_TOKEN not set' };
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        Accept:         'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ event_type: 'garmin-activity', client_payload: payload }),
    });
    // 204 No Content is success for this endpoint.
    if (res.status === 204) return { ok: true };
    return { ok: false, reason: `GitHub returned ${res.status}: ${(await res.text()).slice(0, 200)}` };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}
