import os
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
    r = requests.post("https://www.strava.com/oauth/token", data={
        "client_id": STRAVA_CLIENT_ID,
        "client_secret": STRAVA_CLIENT_SECRET,
        "refresh_token": STRAVA_REFRESH_TOKEN,
        "grant_type": "refresh_token"
    })
    return r.json()["access_token"]

def calculate_tss(moving_time, weighted_watts, ftp):
    if not weighted_watts or not ftp:
        return None
    intensity_factor = weighted_watts / ftp
    tss = (moving_time * weighted_watts * intensity_factor) / (ftp * 3600) * 100
    return round(tss, 1)

def fetch_activities(token, page=1):
    r = requests.get(
        "https://www.strava.com/api/v3/athlete/activities",
        headers={"Authorization": f"Bearer {token}"},
        params={"per_page": 200, "page": page}
    )
    return r.json()

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

            rows.append((
                a["id"],
                a["name"],
                a.get("sport_type", a.get("type")),
                a["start_date"],
                a.get("elapsed_time"),
                moving,
                a.get("distance"),
                a.get("total_elevation_gain"),
                a.get("average_watts"),
                npower,
                a.get("max_watts"),
                a.get("kilojoules"),
                a.get("average_heartrate"),
                a.get("max_heartrate"),
                a.get("suffer_score"),
                a.get("trainer", False),
                a.get("average_speed"),
                tss,
                if_val,
                npower,
            ))

        if rows:
            execute_values(cur, """
                INSERT INTO activities (
                    id, name, sport_type, start_date, elapsed_time,
                    moving_time, distance, total_elevation_gain,
                    average_watts, weighted_average_watts, max_watts,
                    kilojoules, average_heartrate, max_heartrate,
                    suffer_score, trainer, average_speed,
                    tss, intensity_factor, normalized_power
                ) VALUES %s
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    tss = EXCLUDED.tss,
                    updated_at = now()
            """, rows)
            conn.commit()
            synced += len(rows)
            print(f"Synced {len(rows)} activities (page {page})")

        if stop or len(activities) < 200:
            break

        page += 1

    cur.close()
    conn.close()
    print(f"Done. Total synced: {synced}")

if __name__ == "__main__":
    sync()
