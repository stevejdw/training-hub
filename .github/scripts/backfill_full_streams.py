"""
Backfill altitude, distance, latlng, and time streams for activities that have
a streams row (watts/hr already fetched) but are missing distance_km.

This covers the ~3,300 activities backfilled by the old backfill_power_streams.py
which only fetched watts+hr. The compare-pacing feature needs distance_km,
altitude_m, latlng, and time_s to match segments and compute accurate split times.

Safe to re-run — uses ON CONFLICT DO UPDATE with COALESCE so existing data is
never overwritten unless the column is NULL.

Self-paces against Strava's rate limits:
  - 100 requests / 15-min window  -> sleeps when ≥90 used
  - 1000 requests / day           -> stops at 950 used
"""
import os
import time
import math
import json
import requests
import psycopg2
from psycopg2.extras import Json

STRAVA_CLIENT_ID     = os.environ["STRAVA_CLIENT_ID"]
STRAVA_CLIENT_SECRET = os.environ["STRAVA_CLIENT_SECRET"]
STRAVA_REFRESH_TOKEN = os.environ["STRAVA_REFRESH_TOKEN"]
DATABASE_URL         = os.environ["DATABASE_URL"]
LIMIT                = int(os.environ.get("BACKFILL_LIMIT", "60"))

DAILY_LIMIT_STOP_AT  = 950
STREAM_MAX_POINTS    = 5000


# ── DB helpers ───────────────────────────────────────────────────────────────

def connect_db():
    return psycopg2.connect(
        DATABASE_URL,
        keepalives=1,
        keepalives_idle=30,
        keepalives_interval=10,
        keepalives_count=5,
    )

_db = {"conn": None, "cur": None}

def _pre_sleep_close():
    try:
        if _db["cur"]:  _db["cur"].close()
        if _db["conn"]: _db["conn"].close()
    except Exception as e:
        print(f"  (pre-sleep close ignored: {e})")
    _db["cur"] = _db["conn"] = None

def _post_sleep_reopen():
    _db["conn"] = connect_db()
    _db["cur"]  = _db["conn"].cursor()
    print("  DB reconnected after sleep.")


# ── Strava auth ───────────────────────────────────────────────────────────────

def get_access_token():
    r = requests.post("https://www.strava.com/oauth/token", data={
        "client_id":     STRAVA_CLIENT_ID,
        "client_secret": STRAVA_CLIENT_SECRET,
        "refresh_token": STRAVA_REFRESH_TOKEN,
        "grant_type":    "refresh_token",
    })
    if r.status_code != 200:
        raise SystemExit(
            f"Strava token refresh failed: HTTP {r.status_code}\n{r.text[:500]}\n"
            "Likely cause: STRAVA_REFRESH_TOKEN secret is stale."
        )
    d = r.json()
    new_refresh = d.get("refresh_token")
    if new_refresh and new_refresh != STRAVA_REFRESH_TOKEN:
        print("=" * 72)
        print("!! STRAVA ROTATED YOUR REFRESH TOKEN")
        print(f"   New token: {new_refresh}")
        print("   Update BOTH: GitHub secret and Vercel env var.")
        print("=" * 72)
    return d["access_token"]


# ── Rate limiting ─────────────────────────────────────────────────────────────

rate_state = {"window_used": 0, "daily_used": 0}

def update_rate_state(response):
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
    if rate_state["daily_used"] >= DAILY_LIMIT_STOP_AT:
        print(f"  Daily limit reached ({rate_state['daily_used']} calls) — stopping.")
        return False
    if rate_state["window_used"] >= 90:
        wait = 905
        print(f"  15-min window at {rate_state['window_used']}/100 — sleeping {wait}s...")
        _pre_sleep_close()
        time.sleep(wait)
        _post_sleep_reopen()
    return True


# ── Downsampling ──────────────────────────────────────────────────────────────

def downsample(arr, max_pts):
    if not arr or len(arr) <= max_pts:
        return arr
    step = len(arr) / max_pts
    return [arr[round(i * step)] for i in range(max_pts)]


# ── Stream fetch ──────────────────────────────────────────────────────────────

def fetch_geo_streams(token, activity_id):
    """
    Fetch altitude, distance, latlng, time streams.
    Returns (alt, dist_km, latlng, time_s, daily_done).
    Each value is None if unavailable.
    """
    r = requests.get(
        f"https://www.strava.com/api/v3/activities/{activity_id}/streams",
        headers={"Authorization": f"Bearer {token}"},
        params={"keys": "altitude,distance,latlng,time", "key_by_type": "true"},
        timeout=15,
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
            params={"keys": "altitude,distance,latlng,time", "key_by_type": "true"},
            timeout=15,
        )
        update_rate_state(r)

    if not check_rate_limits():
        return None, None, None, None, True

    if r.status_code != 200:
        return None, None, None, None, False

    data = r.json()
    alt_raw    = (data.get("altitude")  or {}).get("data")
    dist_raw   = (data.get("distance")  or {}).get("data")
    latlng_raw = (data.get("latlng")    or {}).get("data")
    time_raw   = (data.get("time")      or {}).get("data")

    # Downsample & convert units
    alt_ds  = [round(a * 10) / 10 for a in downsample(alt_raw,    STREAM_MAX_POINTS)] if alt_raw    else None
    dist_ds = [round(d / 10) / 100 for d in downsample(dist_raw,  STREAM_MAX_POINTS)] if dist_raw   else None  # m → km
    time_ds = [round(t)             for t in downsample(time_raw,  STREAM_MAX_POINTS)] if time_raw   else None
    latlng_ds = None
    if latlng_raw:
        latlng_ds = [
            [round(p[0] * 1e6) / 1e6, round(p[1] * 1e6) / 1e6]
            for p in downsample(latlng_raw, STREAM_MAX_POINTS)
        ]

    return alt_ds, dist_ds, latlng_ds, time_ds, False


# ── Main ──────────────────────────────────────────────────────────────────────

def backfill():
    token = get_access_token()
    _db["conn"] = connect_db()
    _db["cur"]  = _db["conn"].cursor()

    # Ensure columns exist
    for col in ("altitude_m FLOAT[]", "distance_km FLOAT[]", "latlng FLOAT[][]", "time_s INT[]"):
        _db["cur"].execute(
            f"ALTER TABLE activity_streams ADD COLUMN IF NOT EXISTS {col}"
        )
    _db["conn"].commit()

    # Activities with a stream row but missing distance_km (the key column for compare)
    _db["cur"].execute("""
        SELECT s.activity_id, a.name
        FROM activity_streams s
        JOIN activities a ON a.id = s.activity_id
        WHERE s.distance_km IS NULL OR array_length(s.distance_km, 1) IS NULL
        ORDER BY a.start_date DESC
        LIMIT %s
    """, (LIMIT,))
    activities = _db["cur"].fetchall()
    total = len(activities)
    print(f"Activities missing geo streams: {total}  (limit={LIMIT})")
    print(f"Will stop at {DAILY_LIMIT_STOP_AT} daily Strava calls.")

    ok = empty = fail = 0
    for i, (activity_id, name) in enumerate(activities, 1):
        alt, dist_km, latlng, time_s, daily_done = fetch_geo_streams(token, activity_id)
        if daily_done:
            print(f"\nStopped: daily rate limit after {i - 1} activities.")
            break

        if dist_km is None and alt is None:
            # No geo data at all — mark with empty arrays to skip next time
            try:
                _db["cur"].execute(
                    "UPDATE activity_streams SET distance_km = '{}', altitude_m = '{}' WHERE activity_id = %s",
                    (activity_id,)
                )
                _db["conn"].commit()
            except Exception as e:
                print(f"  FAIL  [{i}/{total}] {name}: DB error: {e}")
                _db["conn"].rollback()
                fail += 1
                continue
            print(f"  EMPTY [{i}/{total}] {name}  (window={rate_state['window_used']}, day={rate_state['daily_used']})")
            empty += 1
            continue

        # Convert latlng to postgres array-of-arrays literal
        # psycopg2 doesn't have a native 2D array adapter, so we pass it as a list of lists
        try:
            sql = """
                UPDATE activity_streams
                SET altitude_m  = COALESCE(%s::FLOAT[], altitude_m),
                    distance_km = COALESCE(%s::FLOAT[], distance_km),
                    latlng      = COALESCE(%s::FLOAT[][], latlng),
                    time_s      = COALESCE(%s::INT[], time_s)
                WHERE activity_id = %s
            """
            # Convert latlng list-of-lists to a postgres 2D-array literal: {{lat,lng},...}
            latlng_pg = None
            if latlng:
                inner = ",".join(f"{{{p[0]},{p[1]}}}" for p in latlng)
                latlng_pg = f"{{{inner}}}"

            _db["cur"].execute(sql, (
                alt,
                dist_km,
                latlng_pg,
                time_s,
                activity_id,
            ))
            _db["conn"].commit()
        except psycopg2.OperationalError as e:
            print(f"  DB dropped ({e}) — reconnecting...")
            _pre_sleep_close()
            _post_sleep_reopen()
            _db["cur"].execute(sql, (alt, dist_km, latlng_pg, time_s, activity_id))
            _db["conn"].commit()
        except Exception as e:
            print(f"  FAIL  [{i}/{total}] {name}: {e}")
            _db["conn"].rollback()
            fail += 1
            continue

        pts = len(dist_km) if dist_km else 0
        print(f"  OK    [{i}/{total}] {name}  ({pts} pts, latlng={'yes' if latlng else 'no'}, time={'yes' if time_s else 'no'})  (window={rate_state['window_used']}, day={rate_state['daily_used']})")
        ok += 1

    _db["cur"].close()
    _db["conn"].close()

    # Report remaining
    conn2 = connect_db()
    cur2  = conn2.cursor()
    cur2.execute("""
        SELECT COUNT(*) FROM activity_streams
        WHERE distance_km IS NULL OR array_length(distance_km, 1) IS NULL
    """)
    remaining = cur2.fetchone()[0]
    cur2.close()
    conn2.close()

    print(f"\nDone. ok={ok}  empty={empty}  fail={fail}")
    print(f"Remaining: {remaining}")
    if remaining > 0:
        print("Re-run tomorrow — daily Strava limit resets at 00:00 UTC.")


if __name__ == "__main__":
    backfill()
