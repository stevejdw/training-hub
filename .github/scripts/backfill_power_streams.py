"""
Backfill power and HR streams for activities that don't yet have a stored stream.
Creates the activity_streams table if it doesn't exist.
Safe to re-run — uses ON CONFLICT DO UPDATE.

Self-paces against Strava's rate limits using response headers:
  - 100 requests / 15 min window  -> sleeps when ≥90 used
  - 1000 requests / day           -> stops at 950 used

Set BACKFILL_LIMIT to cap activities per run (default 100).
Set BACKFILL_ALL=1 to process every eligible activity (multi-day safe — just re-run).
"""
import os
import time
import random
import requests
import psycopg2

STRAVA_CLIENT_ID     = os.environ["STRAVA_CLIENT_ID"]
STRAVA_CLIENT_SECRET = os.environ["STRAVA_CLIENT_SECRET"]
STRAVA_REFRESH_TOKEN = os.environ["STRAVA_REFRESH_TOKEN"]
DATABASE_URL         = os.environ["DATABASE_URL"]
LIMIT                = int(os.environ.get("BACKFILL_LIMIT", "100"))
BACKFILL_ALL         = os.environ.get("BACKFILL_ALL", "0") == "1"

# Stop with headroom before hitting daily limit so other app calls still work
DAILY_LIMIT_STOP_AT = 950

def connect_db():
    """Open Neon connection with TCP keepalives so idle waits don't drop us."""
    return psycopg2.connect(
        DATABASE_URL,
        keepalives=1,
        keepalives_idle=30,
        keepalives_interval=10,
        keepalives_count=5,
    )

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

def get_access_token():
    # Strava's edge (CloudFront) intermittently returns HTTP 403 "Request blocked"
    # when several scheduled jobs hit the token endpoint at the same minute. That's
    # transient, so retry with exponential backoff + jitter and only fail fast on a
    # genuine auth error (401 = stale refresh token).
    r = None
    for attempt in range(5):
        try:
            r = requests.post("https://www.strava.com/oauth/token", data={
                "client_id":     STRAVA_CLIENT_ID,
                "client_secret": STRAVA_CLIENT_SECRET,
                "refresh_token": STRAVA_REFRESH_TOKEN,
                "grant_type":    "refresh_token",
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

# Track rate limit state across calls
rate_state = {"window_used": 0, "daily_used": 0}

def update_rate_state(response):
    """Parse X-RateLimit-Usage header and update state."""
    usage = response.headers.get("X-RateLimit-Usage", "")
    if usage:
        parts = usage.split(",")
        if len(parts) == 2:
            try:
                rate_state["window_used"] = int(parts[0].strip())
                rate_state["daily_used"]  = int(parts[1].strip())
            except ValueError:
                pass

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
        _pre_sleep_close()
        time.sleep(wait)
        _post_sleep_reopen()
    return True

def fetch_streams(token, activity_id):
    """Fetch watts+hr streams. Returns (watts, hr, daily_done)."""
    r = requests.get(
        f"https://www.strava.com/api/v3/activities/{activity_id}/streams",
        headers={"Authorization": f"Bearer {token}"},
        params={"keys": "watts,heartrate", "key_by_type": "true"},
    )
    update_rate_state(r)
    if r.status_code == 429:
        print("  Got 429 — sleeping 15 min then retrying once...")
        _pre_sleep_close()
        time.sleep(905)
        _post_sleep_reopen()
        r = requests.get(
            f"https://www.strava.com/api/v3/activities/{activity_id}/streams",
            headers={"Authorization": f"Bearer {token}"},
            params={"keys": "watts,heartrate", "key_by_type": "true"},
        )
        update_rate_state(r)
    if not check_rate_limits():
        return None, None, True
    if r.status_code != 200:
        return None, None, False
    data = r.json()
    return data.get("watts", {}).get("data"), data.get("heartrate", {}).get("data"), False

def backfill():
    token = get_access_token()
    _db["conn"] = connect_db()
    _db["cur"]  = _db["conn"].cursor()

    # Create table + ensure hr column exists
    _db["cur"].execute("""
        CREATE TABLE IF NOT EXISTS activity_streams (
            activity_id BIGINT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
            watts       INT[],
            hr          INT[],
            created_at  TIMESTAMPTZ DEFAULT now()
        )
    """)
    _db["cur"].execute("ALTER TABLE activity_streams ADD COLUMN IF NOT EXISTS hr INT[]")
    _db["conn"].commit()
    print("activity_streams table ready")

    # Fetch activities with power or HR data that don't yet have a stored stream
    if BACKFILL_ALL:
        _db["cur"].execute("""
            SELECT a.id, a.name
            FROM activities a
            LEFT JOIN activity_streams s ON s.activity_id = a.id
            WHERE (a.average_watts IS NOT NULL OR a.average_heartrate IS NOT NULL)
              AND (s.activity_id IS NULL OR s.hr IS NULL)
            ORDER BY a.start_date DESC
        """)
    else:
        _db["cur"].execute("""
            SELECT a.id, a.name
            FROM activities a
            LEFT JOIN activity_streams s ON s.activity_id = a.id
            WHERE (a.average_watts IS NOT NULL OR a.average_heartrate IS NOT NULL)
              AND (s.activity_id IS NULL OR s.hr IS NULL)
            ORDER BY a.start_date DESC
            LIMIT %s
        """, (LIMIT,))

    activities = _db["cur"].fetchall()
    print(f"Activities to backfill: {len(activities)}")
    print(f"Will self-pace and stop at {DAILY_LIMIT_STOP_AT} daily Strava calls.")

    ok = skip = fail = 0
    processed = 0
    for activity_id, name in activities:
        watts, hr, daily_done = fetch_streams(token, activity_id)
        if daily_done:
            print(f"\nStopped early: daily rate limit reached after {processed} activities.")
            break
        # Always write a row — even an empty one — so we don't re-query Strava
        # for activities that genuinely have no streams (e-bikes, old imports,
        # non-power-meter rides with estimated summary watts). Empty arrays act
        # as a "we asked and there was nothing" marker.
        watts_to_store = watts if watts else []
        hr_to_store    = hr    if hr    else []
        is_empty       = not watts and not hr

        insert_sql = """
            INSERT INTO activity_streams (activity_id, watts, hr)
            VALUES (%s, %s, %s)
            ON CONFLICT (activity_id) DO UPDATE
                SET watts = COALESCE(EXCLUDED.watts, activity_streams.watts),
                    hr    = COALESCE(EXCLUDED.hr,    activity_streams.hr)
        """
        try:
            _db["cur"].execute(insert_sql, (activity_id, watts_to_store, hr_to_store))
            _db["conn"].commit()
        except psycopg2.OperationalError as e:
            print(f"  DB dropped ({e}) — reconnecting and retrying once...")
            _pre_sleep_close()
            _post_sleep_reopen()
            _db["cur"].execute(insert_sql, (activity_id, watts_to_store, hr_to_store))
            _db["conn"].commit()
        if is_empty:
            print(f"  EMPTY {name} — marked as no-streams  (window={rate_state['window_used']}, day={rate_state['daily_used']})")
            skip += 1
        else:
            print(f"  OK    {name} (W:{len(watts or [])} HR:{len(hr or [])} pts)  (window={rate_state['window_used']}, day={rate_state['daily_used']})")
            ok += 1
        processed += 1

    _db["cur"].close()
    _db["conn"].close()
    remaining = len(activities) - processed
    print(f"\nDone. ok={ok}  skipped={skip}  failed={fail}")
    if remaining > 0:
        print(f"{remaining} activities still pending — re-run tomorrow (daily limit resets at 00:00 UTC).")

if __name__ == "__main__":
    backfill()
