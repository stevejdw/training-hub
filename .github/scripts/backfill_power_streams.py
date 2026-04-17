"""
Backfill power and HR streams for activities that don't yet have a stored stream.
Creates the activity_streams table if it doesn't exist.
Safe to re-run — uses ON CONFLICT DO UPDATE.

Set BACKFILL_LIMIT env var to control how many activities to process (default 50).
Set BACKFILL_ALL=1 to process every eligible activity.
"""
import os
import time
import requests
import psycopg2

STRAVA_CLIENT_ID     = os.environ["STRAVA_CLIENT_ID"]
STRAVA_CLIENT_SECRET = os.environ["STRAVA_CLIENT_SECRET"]
STRAVA_REFRESH_TOKEN = os.environ["STRAVA_REFRESH_TOKEN"]
DATABASE_URL         = os.environ["DATABASE_URL"]
LIMIT                = int(os.environ.get("BACKFILL_LIMIT", "50"))
BACKFILL_ALL         = os.environ.get("BACKFILL_ALL", "0") == "1"

def get_access_token():
    r = requests.post("https://www.strava.com/oauth/token", data={
        "client_id":     STRAVA_CLIENT_ID,
        "client_secret": STRAVA_CLIENT_SECRET,
        "refresh_token": STRAVA_REFRESH_TOKEN,
        "grant_type":    "refresh_token",
    })
    return r.json()["access_token"]

def fetch_streams(token, activity_id):
    r = requests.get(
        f"https://www.strava.com/api/v3/activities/{activity_id}/streams",
        headers={"Authorization": f"Bearer {token}"},
        params={"keys": "watts,heartrate", "key_by_type": "true"},
    )
    if r.status_code != 200:
        return None, None
    data = r.json()
    return data.get("watts", {}).get("data"), data.get("heartrate", {}).get("data")

def backfill():
    token = get_access_token()
    conn  = psycopg2.connect(DATABASE_URL)
    cur   = conn.cursor()

    # Create table + ensure hr column exists
    cur.execute("""
        CREATE TABLE IF NOT EXISTS activity_streams (
            activity_id BIGINT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
            watts       INT[],
            hr          INT[],
            created_at  TIMESTAMPTZ DEFAULT now()
        )
    """)
    cur.execute("ALTER TABLE activity_streams ADD COLUMN IF NOT EXISTS hr INT[]")
    conn.commit()
    print("activity_streams table ready")

    # Fetch activities with power or HR data that don't yet have a stored stream
    if BACKFILL_ALL:
        cur.execute("""
            SELECT a.id, a.name
            FROM activities a
            LEFT JOIN activity_streams s ON s.activity_id = a.id
            WHERE (a.average_watts IS NOT NULL OR a.average_heartrate IS NOT NULL)
              AND s.activity_id IS NULL
            ORDER BY a.start_date DESC
        """)
    else:
        cur.execute("""
            SELECT a.id, a.name
            FROM activities a
            LEFT JOIN activity_streams s ON s.activity_id = a.id
            WHERE (a.average_watts IS NOT NULL OR a.average_heartrate IS NOT NULL)
              AND s.activity_id IS NULL
            ORDER BY a.start_date DESC
            LIMIT %s
        """, (LIMIT,))

    activities = cur.fetchall()
    print(f"Activities to backfill: {len(activities)}")

    ok = skip = fail = 0
    for activity_id, name in activities:
        watts, hr = fetch_streams(token, activity_id)
        if not watts and not hr:
            print(f"  SKIP  {name} — no streams")
            skip += 1
            time.sleep(0.3)
            continue

        cur.execute("""
            INSERT INTO activity_streams (activity_id, watts, hr)
            VALUES (%s, %s, %s)
            ON CONFLICT (activity_id) DO UPDATE
                SET watts = COALESCE(EXCLUDED.watts, activity_streams.watts),
                    hr    = COALESCE(EXCLUDED.hr,    activity_streams.hr)
        """, (activity_id, watts, hr))
        conn.commit()
        print(f"  OK    {name} (W:{len(watts or [])} HR:{len(hr or [])} pts)")
        ok += 1
        time.sleep(0.5)

    cur.close()
    conn.close()
    print(f"\nDone. ok={ok}  skipped={skip}  failed={fail}")

if __name__ == "__main__":
    backfill()
