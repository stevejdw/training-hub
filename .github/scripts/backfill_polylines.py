"""
Backfill summary_polyline for all existing activities.
Pages through all Strava activities and updates the DB.
Safe to run multiple times - skips activities that already have a polyline.
"""
import os
import time
import requests
import psycopg2

STRAVA_CLIENT_ID = os.environ["STRAVA_CLIENT_ID"]
STRAVA_CLIENT_SECRET = os.environ["STRAVA_CLIENT_SECRET"]
STRAVA_REFRESH_TOKEN = os.environ["STRAVA_REFRESH_TOKEN"]
DATABASE_URL = os.environ["DATABASE_URL"]

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

def fetch_page(token, page):
    r = requests.get(
        "https://www.strava.com/api/v3/athlete/activities",
        headers={"Authorization": f"Bearer {token}"},
        params={"per_page": 200, "page": page}
    )
    # Respect rate limit headers
    limit_15 = int(r.headers.get("X-RateLimit-Limit", "100").split(",")[0])
    usage_15 = int(r.headers.get("X-RateLimit-Usage", "0").split(",")[0])
    if usage_15 >= limit_15 - 2:
        print(f"  Rate limit close ({usage_15}/{limit_15}), sleeping 15 minutes...")
        time.sleep(910)
    return r.json()

def backfill():
    token = get_access_token()
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    # Count how many need backfilling
    cur.execute("SELECT COUNT(*) FROM activities WHERE summary_polyline IS NULL")
    missing = cur.fetchone()[0]
    print(f"Activities missing polyline: {missing}")
    if missing == 0:
        print("Nothing to backfill.")
        conn.close()
        return

    page = 1
    updated = 0
    total_processed = 0

    while True:
        print(f"Fetching page {page}...")
        activities = fetch_page(token, page)
        if not activities:
            break

        for a in activities:
            total_processed += 1
            polyline = a.get("map", {}).get("summary_polyline")
            if not polyline:
                continue
            cur.execute(
                "UPDATE activities SET summary_polyline = %s, updated_at = now() WHERE id = %s AND summary_polyline IS NULL",
                (polyline, a["id"])
            )
            if cur.rowcount > 0:
                updated += 1

        conn.commit()
        print(f"  Page {page}: {updated} total updated so far (processed {total_processed} activities)")

        if len(activities) < 200:
            break
        page += 1
        time.sleep(0.5)  # be polite to Strava API

    cur.close()
    conn.close()
    print(f"\nDone. Updated {updated} activities with polylines.")

if __name__ == "__main__":
    backfill()
