"""
Backfill laps (with calculated NP) for activities that have no laps stored.
Self-paces against Strava's rate limits using response headers:
  - 100 requests / 15 min window
  - 1000 requests / day

Safe to re-run — only processes activities still missing laps.
"""
import os
import time
import random
import requests
import psycopg2
from psycopg2.extras import execute_values

STRAVA_CLIENT_ID = os.environ["STRAVA_CLIENT_ID"]
STRAVA_CLIENT_SECRET = os.environ["STRAVA_CLIENT_SECRET"]
STRAVA_REFRESH_TOKEN = os.environ["STRAVA_REFRESH_TOKEN"]
DATABASE_URL = os.environ["DATABASE_URL"]
LIMIT = int(os.environ.get("BACKFILL_LIMIT", "500"))

# Stop with headroom before hitting daily limit so other app calls still work
DAILY_LIMIT_STOP_AT = 950

FATAL_DB_ERRORS = (
    "password authentication failed",
    'role "',
    "does not exist",
    "no pg_hba.conf entry",
)


def connect_db():
    """Open Neon connection with TCP keepalives so idle waits don't drop us."""
    last_err = None
    for attempt in range(5):
        try:
            return psycopg2.connect(
                DATABASE_URL,
                connect_timeout=15,
                keepalives=1,
                keepalives_idle=30,
                keepalives_interval=10,
                keepalives_count=5,
            )
        except psycopg2.OperationalError as e:
            if any(s in str(e).lower() for s in FATAL_DB_ERRORS):
                raise SystemExit(
                    f"DATABASE_URL is rejected by Neon: {e}\n"
                    "This will not fix itself — the credential is stale or revoked.\n"
                    "Update the DATABASE_URL GitHub secret from the current Neon "
                    "connection string (and check the Vercel env var matches)."
                )
            last_err = e
            print(f"DB connect failed (attempt {attempt + 1}/5): {e}")
            time.sleep(2 ** attempt + random.uniform(0, 1))
    # Neon (serverless) can be briefly unreachable (cold start / network blip).
    # A transient DB outage on a frequent cron isn't actionable, so skip this
    # run (exit 0) instead of failing the job and sending a failure email.
    print(
        f"Database unreachable after 5 attempts: {last_err}\n"
        "Skipping this run; the next scheduled run will catch up.",
        flush=True,
    )
    raise SystemExit(0)

def get_access_token():
    # Strava's edge (CloudFront) intermittently returns HTTP 403 "Request blocked"
    # when several scheduled jobs hit the token endpoint at the same minute. That's
    # transient, so retry with exponential backoff + jitter and only fail fast on a
    # genuine auth error (401 = stale refresh token).
    r = None
    for attempt in range(5):
        try:
            r = requests.post("https://www.strava.com/oauth/token", data={
                "client_id": STRAVA_CLIENT_ID,
                "client_secret": STRAVA_CLIENT_SECRET,
                "refresh_token": STRAVA_REFRESH_TOKEN,
                "grant_type": "refresh_token"
            }, timeout=30)
        except requests.RequestException as e:
            print(f"Token refresh network error (attempt {attempt + 1}/5): {e}")
            time.sleep(2 ** attempt + random.uniform(0, 1))
            continue
        if r.status_code == 200:
            break
        if r.status_code == 401:
            raise SystemExit(
                f"Strava token refresh failed: HTTP 401 (unauthorized)\n"
                f"Response body: {r.text[:500]}\n"
                f"Likely cause: STRAVA_REFRESH_TOKEN GitHub secret is stale. "
                f"Copy the current value from Vercel env vars and update the secret."
            )
        print(
            f"Token refresh got HTTP {r.status_code} (attempt {attempt + 1}/5) — "
            f"transient edge block/throttle, retrying..."
        )
        time.sleep(2 ** attempt + random.uniform(0, 1))
    else:
        code = r.status_code if r is not None else "no response"
        body = r.text[:500] if r is not None else ""
        # A transient 403/5xx/network block on a frequent cron is not actionable:
        # the next scheduled run catches up. Exit 0 so it doesn't fail the job and
        # spam failure emails. A genuinely stale token (401) already exited above.
        print(
            f"Strava token refresh failed after 5 attempts: HTTP {code}\n{body}\n"
            f"A 403 'Request blocked' page is Strava's CloudFront edge throttling "
            f"concurrent jobs, not a stale token. Skipping this run; the next "
            f"scheduled run will catch up.",
            flush=True,
        )
        raise SystemExit(0)
    try:
        d = r.json()
    except ValueError:
        raise SystemExit(f"Strava token refresh returned non-JSON: {r.text[:500]}")
    if "access_token" not in d:
        raise SystemExit(f"Strava token refresh missing access_token. Response: {d}")
    new_refresh = d.get("refresh_token")
    if new_refresh and new_refresh != STRAVA_REFRESH_TOKEN:
        print("=" * 72)
        print("!! STRAVA ROTATED YOUR REFRESH TOKEN")
        print(f"   Old (in secret): {STRAVA_REFRESH_TOKEN[:10]}...")
        print(f"   New (from Strava): {new_refresh}")
        print("   Update BOTH: GitHub secret STRAVA_REFRESH_TOKEN and Vercel env var.")
        print("   Future runs will fail until you do.")
        print("=" * 72)
    return d["access_token"]

def calculate_np(power_values):
    clean = [p if p is not None else 0 for p in power_values]
    if len(clean) < 30:
        return None
    window = 30
    rolling = [
        sum(clean[i:i+window]) / window
        for i in range(len(clean) - window + 1)
    ]
    return round((sum(x**4 for x in rolling) / len(rolling)) ** 0.25, 1)

# Track rate limit state across calls
rate_state = {"window_used": 0, "daily_used": 0}

def update_rate_state(response):
    """Parse X-RateLimit-Usage header and update state."""
    usage = response.headers.get("X-RateLimit-Usage", "")
    if usage:
        parts = usage.split(",")
        if len(parts) == 2:
            rate_state["window_used"] = int(parts[0].strip())
            rate_state["daily_used"]  = int(parts[1].strip())

def check_rate_limits():
    """
    Sleep if approaching the 15-min window limit (≥90 of 100).
    Returns False if the daily limit is reached and we should stop.
    """
    if rate_state["daily_used"] >= DAILY_LIMIT_STOP_AT:
        print(f"  Daily limit reached ({rate_state['daily_used']} calls used) — stopping for today.")
        return False
    if rate_state["window_used"] >= 90:
        wait = 905  # 15 min + 5s buffer
        print(f"  15-min window at {rate_state['window_used']}/100 — sleeping {wait}s...")
        # Close DB before long sleep so Neon doesn't drop a stale SSL socket on us
        _pre_sleep_close()
        time.sleep(wait)
        _post_sleep_reopen()
    return True

# Managed DB handle so rate-limit sleeps can cleanly cycle the connection
_db = {"conn": None, "cur": None}

def _pre_sleep_close():
    try:
        if _db["cur"]: _db["cur"].close()
        if _db["conn"]: _db["conn"].close()
    except Exception as e:
        print(f"  (pre-sleep close ignored: {e})")
    _db["cur"] = None
    _db["conn"] = None

def _post_sleep_reopen():
    _db["conn"] = connect_db()
    _db["cur"]  = _db["conn"].cursor()
    print("  DB reconnected after sleep.")

def strava_get(token, url, params=None):
    """GET with rate limit tracking. Returns (response|None, hit_daily_limit)."""
    r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, params=params)
    update_rate_state(r)
    if r.status_code == 429:
        # Shouldn't happen if we pace correctly, but handle gracefully
        print("  Got 429 — sleeping 15 min then retrying once...")
        _pre_sleep_close()
        time.sleep(905)
        _post_sleep_reopen()
        r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, params=params)
        update_rate_state(r)
    if not check_rate_limits():
        return None, True
    return r, False

def backfill():
    token = get_access_token()
    _db["conn"] = connect_db()
    _db["cur"]  = _db["conn"].cursor()

    _db["cur"].execute("""
        SELECT a.id, a.name FROM activities a
        WHERE NOT EXISTS (SELECT 1 FROM laps l WHERE l.activity_id = a.id)
        ORDER BY a.start_date DESC
        LIMIT %s
    """, (LIMIT,))
    activities = _db["cur"].fetchall()
    print(f"Found {len(activities)} activities with no laps — backfilling...")
    print(f"Strava allows ~500 activities/day. Will self-pace and stop at {DAILY_LIMIT_STOP_AT} daily calls.")

    processed = 0
    for activity_id, name in activities:
        # ── fetch laps ──────────────────────────────────────────
        laps_r, daily_done = strava_get(
            token,
            f"https://www.strava.com/api/v3/activities/{activity_id}/laps"
        )
        if daily_done:
            break
        laps = laps_r.json() if laps_r and laps_r.status_code == 200 else []
        if not laps:
            print(f"  {name}: no laps (window={rate_state['window_used']}, day={rate_state['daily_used']})")
            time.sleep(0.2)
            continue

        # ── fetch power stream ───────────────────────────────────
        stream_r, daily_done = strava_get(
            token,
            f"https://www.strava.com/api/v3/activities/{activity_id}/streams",
            params={"keys": "watts", "key_by_type": "true"}
        )
        if daily_done:
            # Commit laps without NP rather than lose them
            power_stream = None
        else:
            stream_data  = stream_r.json() if stream_r and stream_r.status_code == 200 else {}
            power_stream = stream_data.get("watts", {}).get("data")

        # ── build lap rows ───────────────────────────────────────
        np_count = 0
        lap_rows = []
        for lap in laps:
            start_idx = lap.get("start_index")
            end_idx   = lap.get("end_index")
            np_val    = None
            if power_stream and start_idx is not None and end_idx is not None:
                np_val = calculate_np(power_stream[start_idx:end_idx + 1])
                if np_val:
                    np_count += 1
            lap_rows.append((
                lap["id"], activity_id,
                lap.get("name"), lap.get("lap_index"),
                lap.get("elapsed_time"), lap.get("moving_time"),
                lap.get("distance"), lap.get("average_watts"), np_val,
                lap.get("average_heartrate"), lap.get("max_heartrate"),
                lap.get("average_speed"), lap.get("total_elevation_gain"),
                start_idx, end_idx,
            ))

        insert_sql = """
            INSERT INTO laps (
                id, activity_id, name, lap_index,
                elapsed_time, moving_time, distance,
                average_watts, normalized_power,
                average_heartrate, max_heartrate,
                average_speed, total_elevation_gain,
                start_index, end_index
            ) VALUES %s
            ON CONFLICT (id) DO UPDATE SET
                normalized_power  = EXCLUDED.normalized_power,
                average_watts     = EXCLUDED.average_watts,
                average_heartrate = EXCLUDED.average_heartrate,
                max_heartrate     = EXCLUDED.max_heartrate,
                start_index       = EXCLUDED.start_index,
                end_index         = EXCLUDED.end_index
        """
        try:
            execute_values(_db["cur"], insert_sql, lap_rows)
            _db["conn"].commit()
        except psycopg2.OperationalError as e:
            # Neon dropped the socket (shouldn't happen with keepalives, but be defensive)
            print(f"  DB dropped ({e}) — reconnecting and retrying once...")
            _pre_sleep_close()
            _post_sleep_reopen()
            execute_values(_db["cur"], insert_sql, lap_rows)
            _db["conn"].commit()

        processed += 1
        print(f"  [{processed}] {name}: {len(lap_rows)} laps, {np_count} NP  (window={rate_state['window_used']}, day={rate_state['daily_used']})")

        if daily_done:
            break

    _db["cur"].close()
    _db["conn"].close()
    print(f"\nDone. Processed {processed} activities. {len(activities) - processed} still pending (re-run tomorrow).")

if __name__ == "__main__":
    backfill()
