import os
import requests
from datetime import datetime
from supabase import create_client

STRAVA_CLIENT_ID = os.environ["STRAVA_CLIENT_ID"]
STRAVA_CLIENT_SECRET = os.environ["STRAVA_CLIENT_SECRET"]
STRAVA_REFRESH_TOKEN = os.environ["STRAVA_REFRESH_TOKEN"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

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
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    result = supabase.table("activities")\
        .select("start_date")\
        .order("start_date", desc=True)\
        .limit(1)\
        .execute()

    last_date = None
    if result.data:
        last_date = datetime.fromisoformat(result.data[0]["start_date"].replace("Z", "+00:00"))
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

            rows.append({
                "id": a["id"],
                "name": a["name"],
                "sport_type": a.get("sport_type", a.get("type")),
                "start_date": a["start_date"],
                "elapsed_time": a.get("elapsed_time"),
                "moving_time": moving,
                "distance": a.get("distance"),
                "total_elevation_gain": a.get("total_elevation_gain"),
                "average_watts": a.get("average_watts"),
                "weighted_average_watts": npower,
                "max_watts": a.get("max_watts"),
                "kilojoules": a.get("kilojoules"),
                "average_heartrate": a.get("average_heartrate"),
                "max_heartrate": a.get("max_heartrate"),
                "suffer_score": a.get("suffer_score"),
                "trainer": a.get("trainer", False),
                "average_speed": a.get("average_speed"),
                "tss": tss,
                "intensity_factor": if_val,
                "normalized_power": npower,
            })

        if rows:
            supabase.table("activities").upsert(rows).execute()
            synced += len(rows)
            print(f"Synced {len(rows)} activities (page {page})")

        if stop or len(activities) < 200:
            break

        page += 1

    print(f"Done. Total synced: {synced}")

if __name__ == "__main__":
    sync()
