import pool from '@/lib/db';

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
 * Needs GH_DISPATCH_TOKEN, a fine-grained PAT scoped to this repository. The
 * two ways to start a workflow want *different* permissions, and the naming is
 * actively misleading:
 *
 *   POST /actions/workflows/{file}/dispatches  → Actions: read and write
 *   POST /dispatches  (repository_dispatch)    → Contents: read and write
 *
 * The second is filed under "repos" in GitHub's REST docs and does not accept
 * an Actions-scoped token, which is why the original `Actions: write` token
 * 403'd on it for 20 days. Rather than depend on which one was granted, try
 * the Actions endpoint and fall back to the repository one.
 */

const REPO = process.env.GITHUB_DISPATCH_REPO ?? 'stevejdw/training-hub';
const WORKFLOW = process.env.GITHUB_DISPATCH_WORKFLOW ?? 'garmin-push.yml';
const REF = process.env.GITHUB_DISPATCH_REF ?? 'main';

export interface DispatchResult {
  ok: boolean;
  via?: 'workflow_dispatch' | 'repository_dispatch';
  reason?: string;
}

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * A dead doorbell is invisible: the webhook still returns 200 to Strava, the
 * scheduled poll still eventually lands the ride, and the only trace is a
 * console.log nobody reads. Record it where the Settings page already looks so
 * the next failure surfaces in hours rather than weeks.
 */
async function recordHealth(ok: boolean, detail: string): Promise<void> {
  try {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS sync_health (
          provider             TEXT PRIMARY KEY,
          last_ok_at           TIMESTAMPTZ,
          last_error           TEXT,
          consecutive_failures INT NOT NULL DEFAULT 0,
          detail               TEXT,
          updated_at           TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      if (ok) {
        await client.query(`
          INSERT INTO sync_health (provider, last_ok_at, last_error, consecutive_failures, detail, updated_at)
          VALUES ('garmin-doorbell', NOW(), NULL, 0, $1, NOW())
          ON CONFLICT (provider) DO UPDATE SET
            last_ok_at = NOW(), last_error = NULL, consecutive_failures = 0,
            detail = EXCLUDED.detail, updated_at = NOW()
        `, [detail.slice(0, 200)]);
      } else {
        await client.query(`
          INSERT INTO sync_health (provider, last_error, consecutive_failures, updated_at)
          VALUES ('garmin-doorbell', $1, 1, NOW())
          ON CONFLICT (provider) DO UPDATE SET
            last_error = EXCLUDED.last_error,
            consecutive_failures = sync_health.consecutive_failures + 1,
            updated_at = NOW()
        `, [detail.slice(0, 500)]);
      }
    } finally {
      client.release();
    }
  } catch {
    // Health recording must never be the reason a sync trigger fails.
  }
}

export async function dispatchGarminSync(
  payload: Record<string, unknown> = {}
): Promise<DispatchResult> {
  const token = process.env.GH_DISPATCH_TOKEN?.trim();
  if (!token) {
    const reason = 'GH_DISPATCH_TOKEN not set';
    await recordHealth(false, reason);
    return { ok: false, reason };
  }

  const attempts: string[] = [];

  // Preferred: workflow_dispatch. Needs Actions: write.
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
      {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ ref: REF }),
      }
    );
    if (res.status === 204) {
      await recordHealth(true, `workflow_dispatch ${WORKFLOW}`);
      return { ok: true, via: 'workflow_dispatch' };
    }
    attempts.push(`workflow_dispatch ${res.status}: ${(await res.text()).slice(0, 150)}`);
  } catch (err) {
    attempts.push(`workflow_dispatch threw: ${String(err).slice(0, 150)}`);
  }

  // Fallback: repository_dispatch. Needs Contents: write, and carries the
  // payload — worth keeping for the trigger reason it records on the run.
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ event_type: 'garmin-activity', client_payload: payload }),
    });
    if (res.status === 204) {
      await recordHealth(true, 'repository_dispatch garmin-activity');
      return { ok: true, via: 'repository_dispatch' };
    }
    attempts.push(`repository_dispatch ${res.status}: ${(await res.text()).slice(0, 150)}`);
  } catch (err) {
    attempts.push(`repository_dispatch threw: ${String(err).slice(0, 150)}`);
  }

  const reason = attempts.join(' | ');
  await recordHealth(false, reason);
  return { ok: false, reason };
}
