"""
Backfill laps (with calculated NP) for the last N activities.
Fetches power stream per activity and calculates NP per lap slice.
Safe to re-run — uses ON CONFLICT DO UPDATE to refresh NP values.
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
LIMIT = int(os.environ.get("BACKFILL_LIMIT", "10"))

def get_access_token():
    r = requests.post("https://www.strava.com/oauth/token", data={
        "client_id": STRAVA_CLIENT_ID,
        "client_secret": STRAVA_CLIENT_SECRET,
        "refresh_token": STRAVA_REFRESH_TOKEN,
        "grant_type": "refresh_token"
    })
    return r.json()["access_token"]

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

def fetch_power_stream(token, activity_id):
    r = requests.get(
        f"https://www.strava.com/api/v3/activities/{activity_id}/streams",
        headers={"Authorization": f"Bearer {token}"},
        params={"keys": "watts", "key_by_type": "true"}
    )
    if r.status_code != 200:
        return None
    return r.json().get("watts", {}).get("data")

def fetch_laps(token, activity_id):
    r = requests.get(
        f"https://www.strava.com/api/v3/activities/{activity_id}/laps",
        headers={"Authorization": f"Bearer {token}"}
    )
    return r.json() if r.status_code == 200 else []

def backfill():
    token = get_access_token()
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    cur.execute("""
        SELECT id, name FROM activities
        ORDER BY start_date DESC
        LIMIT %s
    """, (LIMIT,))
    activities = cur.fetchall()
    print(f"Backfilling laps + NP for {len(activities)} activities...")

    for activity_id, name in activities:
        laps = fetch_laps(token, activity_id)
        if not laps:
            print(f"  {name}: no laps")
            time.sleep(0.3)
            continue

        power_stream = fetch_power_stream(token, activity_id)
        np_count = 0

        lap_rows = []
        for lap in laps:
            start_idx = lap.get("start_index")
            end_idx = lap.get("end_index")
            np_val = None
            if power_stream and start_idx is not None and end_idx is not None:
                slice_ = power_stream[start_idx:end_idx + 1]
                np_val = calculate_np(slice_)
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
                normalized_power = EXCLUDED.normalized_power,
                average_watts = EXCLUDED.average_watts,
                average_heartrate = EXCLUDED.average_heartrate,
                max_heartrate = EXCLUDED.max_heartrate,
                start_index = EXCLUDED.start_index,
                end_index = EXCLUDED.end_index
        """, lap_rows)
        conn.commit()
        print(f"  {name}: {len(lap_rows)} laps, {np_count} with NP")
        time.sleep(0.5)

    cur.close()
    conn.close()
    print("Done.")

if __name__ == "__main__":
    backfill()
