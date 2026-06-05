import os
import time
import random
import requests
from datetime import datetime, timezone
import psycopg2
from psycopg2.extras import execute_values

STRAVA_CLIENT_ID = os.environ["STRAVA_CLIENT_ID"]
STRAVA_CLIENT_SECRET = os.environ["STRAVA_CLIENT_SECRET"]
STRAVA_REFRESH_TOKEN = os.environ["STRAVA_REFRESH_TOKEN"]
DATABASE_URL = os.environ["DATABASE_URL"]

FTP = 340

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
        raise SystemExit(
            f"Strava token refresh failed after 5 attempts: HTTP {code}\n{body}\n"
            f"A 403 'Request blocked' page is Strava's CloudFront edge throttling "
            f"concurrent jobs, not a stale token; it usually clears on the next run."
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

def calculate_tss(moving_time, weighted_watts, ftp):
    if not weighted_watts or not ftp:
        return None
    intensity_factor = weighted_watts / ftp
    tss = (moving_time * weighted_watts * intensity_factor) / (ftp * 3600) * 100
    return round(tss, 1)

def calculate_np(power_values):
    """Calculate Normalized Power from a list of per-second watts."""
    clean = [p if p is not None else 0 for p in power_values]
    if len(clean) < 30:
        return None
    window = 30
    rolling = [
        sum(clean[i:i+window]) / window
        for i in range(len(clean) - window + 1)
    ]
    np_val = (sum(x**4 for x in rolling) / len(rolling)) ** 0.25
    return round(np_val, 1)

def fetch_activities(token, page=1):
    r = requests.get(
        "https://www.strava.com/api/v3/athlete/activities",
        headers={"Authorization": f"Bearer {token}"},
        params={"per_page": 200, "page": page}
    )
    return r.json()

def fetch_streams(token, activity_id):
    """Returns (watts_list, hr_list) — either may be None."""
    r = requests.get(
        f"https://www.strava.com/api/v3/activities/{activity_id}/streams",
        headers={"Authorization": f"Bearer {token}"},
        params={"keys": "watts,heartrate", "key_by_type": "true"}
    )
    if r.status_code != 200:
        return None, None
    data = r.json()
    return data.get("watts", {}).get("data"), data.get("heartrate", {}).get("data")

def fetch_laps(token, activity_id):
    r = requests.get(
        f"https://www.strava.com/api/v3/activities/{activity_id}/laps",
        headers={"Authorization": f"Bearer {token}"}
    )
    return r.json() if r.status_code == 200 else []

def sync():
    token = get_access_token()
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    cur.execute("SELECT start_date FROM activities ORDER BY start_date DESC LIMIT 1")
    row = cur.fetchone()
    last_date = row[0] if row else None

    if last_date:
        print(f"Syncing activities after {last_date}")
    else:
        print("Full sync - no existing data")

    page = 1
    synced = 0

    while True:
        activities = fetch_activities(token, page)
        if not activities:
            break

        rows = []
        new_activity_ids = []
        stop = False

        for a in activities:
            start = datetime.fromisoformat(a["start_date"].replace("Z", "+00:00"))

            if last_date and start <= last_date:
                stop = True
                break

            npower = a.get("weighted_average_watts")
            moving = a.get("moving_time", 0)
            tss = calculate_tss(moving, npower, FTP)
            if_val = round(npower / FTP, 3) if npower and FTP else None
            polyline = a.get("map", {}).get("summary_polyline")

            rows.append((
                a["id"], a["name"],
                a.get("sport_type", a.get("type")),
                a["start_date"],
                a.get("elapsed_time"), moving,
                a.get("distance"), a.get("total_elevation_gain"),
                a.get("average_watts"), npower, a.get("max_watts"),
                a.get("kilojoules"), a.get("average_heartrate"),
                a.get("max_heartrate"), a.get("suffer_score"),
                a.get("trainer", False), a.get("average_speed"),
                tss, if_val, npower, polyline,
            ))
            new_activity_ids.append(a["id"])

        if rows:
            execute_values(cur, """
                INSERT INTO activities (
                    id, name, sport_type, start_date, elapsed_time,
                    moving_time, distance, total_elevation_gain,
                    average_watts, weighted_average_watts, max_watts,
                    kilojoules, average_heartrate, max_heartrate,
                    suffer_score, trainer, average_speed,
                    tss, intensity_factor, normalized_power, summary_polyline
                ) VALUES %s
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    tss = EXCLUDED.tss,
                    summary_polyline = EXCLUDED.summary_polyline,
                    updated_at = now()
            """, rows)
            conn.commit()
            synced += len(rows)
            print(f"Synced {len(rows)} activities (page {page})")

        # Ensure hr column exists
        cur.execute("ALTER TABLE activity_streams ADD COLUMN IF NOT EXISTS hr INT[]")
        conn.commit()

        # Fetch laps + streams for each new activity
        for activity_id in new_activity_ids:
            laps = fetch_laps(token, activity_id)
            power_stream, hr_stream = fetch_streams(token, activity_id)

            # Store streams
            if power_stream or hr_stream:
                cur.execute("""
                    INSERT INTO activity_streams (activity_id, watts, hr)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (activity_id) DO UPDATE
                        SET watts = COALESCE(EXCLUDED.watts, activity_streams.watts),
                            hr    = COALESCE(EXCLUDED.hr,    activity_streams.hr)
                """, (activity_id, power_stream, hr_stream))
                conn.commit()
                pts = len(power_stream or [])
                hr_pts = len(hr_stream or [])
                print(f"  Stored streams ({pts}W pts, {hr_pts}HR pts) for activity {activity_id}")

            if not laps:
                continue

            lap_rows = []
            for lap in laps:
                start_idx = lap.get("start_index")
                end_idx = lap.get("end_index")
                np_val = None
                if power_stream and start_idx is not None and end_idx is not None:
                    slice_ = power_stream[start_idx:end_idx + 1]
                    np_val = calculate_np(slice_)

                lap_rows.append((
                    lap["id"], activity_id,
                    lap.get("name"), lap.get("lap_index"),
                    lap.get("elapsed_time"), lap.get("moving_time"),
                    lap.get("distance"), lap.get("average_watts"), np_val,
                    lap.get("average_heartrate"), lap.get("max_heartrate"),
                    lap.get("average_speed"), lap.get("total_elevation_gain"),
                    start_idx, end_idx,
                ))

            if lap_rows:
                execute_values(cur, """
                    INSERT INTO laps (
                        id, activity_id, name, lap_index,
                        elapsed_time, moving_time, distance,
                        average_watts, normalized_power,
                        average_heartrate, max_heartrate,
                        average_speed, total_elevation_gain,
                        start_index, end_index
                    ) VALUES %s
                    ON CONFLICT (id) DO NOTHING
                """, lap_rows)
                conn.commit()
                print(f"  Stored {len(lap_rows)} laps for activity {activity_id}")

        if stop or len(activities) < 200:
            break
        page += 1

    cur.close()
    conn.close()
    print(f"Done. Total synced: {synced}")

if __name__ == "__main__":
    sync()
