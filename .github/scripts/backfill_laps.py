"""
Backfill laps for the last N activities that have no lap data.
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

def backfill():
    token = get_access_token()
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    # Get last N activities that have no laps yet
    cur.execute("""
        SELECT a.id, a.name FROM activities a
        WHERE NOT EXISTS (SELECT 1 FROM laps l WHERE l.activity_id = a.id)
        ORDER BY a.start_date DESC
        LIMIT %s
    """, (LIMIT,))
    activities = cur.fetchall()
    print(f"Backfilling laps for {len(activities)} activities...")

    for activity_id, name in activities:
        r = requests.get(
            f"https://www.strava.com/api/v3/activities/{activity_id}/laps",
            headers={"Authorization": f"Bearer {token}"}
        )
        if r.status_code != 200:
            print(f"  Skipping {name} ({activity_id}): HTTP {r.status_code}")
            continue

        laps = r.json()
        if not laps:
            print(f"  {name}: no laps")
            continue

        lap_rows = [(
            lap["id"], activity_id, lap.get("name"), lap.get("lap_index"),
            lap.get("elapsed_time"), lap.get("moving_time"), lap.get("distance"),
            lap.get("average_watts"), lap.get("average_watts"),
            lap.get("average_heartrate"), lap.get("max_heartrate"),
            lap.get("average_speed"), lap.get("total_elevation_gain"),
        ) for lap in laps]

        execute_values(cur, """
            INSERT INTO laps (
                id, activity_id, name, lap_index,
                elapsed_time, moving_time, distance,
                average_watts, normalized_power,
                average_heartrate, max_heartrate,
                average_speed, total_elevation_gain
            ) VALUES %s
            ON CONFLICT (id) DO NOTHING
        """, lap_rows)
        conn.commit()
        print(f"  {name}: {len(lap_rows)} laps stored")
        time.sleep(0.3)

    cur.close()
    conn.close()
    print("Done.")

if __name__ == "__main__":
    backfill()
