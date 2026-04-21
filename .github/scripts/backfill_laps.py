"""
Backfill laps (with calculated NP) for activities that have no laps stored.
Self-paces against Strava's rate limits using response headers:
  - 100 requests / 15 min window
  - 1000 requests / day

Safe to re-run — only processes activities still missing laps.
"""
import os
import time
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

def get_access_token():
    r = requests.post("https://www.strava.com/oauth/token", data={
        "client_id": STRAVA_CLIENT_ID,
        "client_secret": STRAVA_CLIENT_SECRET,
        "refresh_token": STRAVA_REFRESH_TOKEN,
        "grant_type": "refresh_token"
    })
    if r.status_code != 200:
        raise SystemExit(
            f"Strava token refresh failed: HTTP {r.status_code}\n"
            f"Response body: {r.text[:500]}\n"
            f"Likely cause: STRAVA_REFRESH_TOKEN GitHub secret is stale. "
            f"Copy the current value from Vercel env vars and update the secret."
        )
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
        time.sleep(wait)
    return True

def strava_get(token, url, params=None):
    """GET with rate limit tracking. Returns (response|None, hit_daily_limit)."""
    r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, params=params)
    update_rate_state(r)
    if r.status_code == 429:
        # Shouldn't happen if we pace correctly, but handle gracefully
        print("  Got 429 — sleeping 15 min then retrying once...")
        time.sleep(905)
        r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, params=params)
        update_rate_state(r)
    if not check_rate_limits():
        return None, True
    return r, False

def backfill():
    token = get_access_token()
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    cur.execute("""
        SELECT a.id, a.name FROM activities a
        WHERE NOT EXISTS (SELECT 1 FROM laps l WHERE l.activity_id = a.id)
        ORDER BY a.start_date DESC
        LIMIT %s
    """, (LIMIT,))
    activities = cur.fetchall()
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

        execute_values(cur, """
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
        """, lap_rows)
        conn.commit()
        processed += 1
        print(f"  [{processed}] {name}: {len(lap_rows)} laps, {np_count} NP  (window={rate_state['window_used']}, day={rate_state['daily_used']})")

        if daily_done:
            break

    cur.close()
    conn.close()
    print(f"\nDone. Processed {processed} activities. {len(activities) - processed} still pending (re-run tomorrow).")

if __name__ == "__main__":
    backfill()
