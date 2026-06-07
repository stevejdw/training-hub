"""
Backfill summary_polyline for all existing activities.
Pages through all Strava activities and updates the DB.
Safe to run multiple times - skips activities that already have a polyline.
"""
import os
import time
import random
import requests
import psycopg2

STRAVA_CLIENT_ID = os.environ["STRAVA_CLIENT_ID"]
STRAVA_CLIENT_SECRET = os.environ["STRAVA_CLIENT_SECRET"]
STRAVA_REFRESH_TOKEN = os.environ["STRAVA_REFRESH_TOKEN"]
DATABASE_URL = os.environ["DATABASE_URL"]

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

def connect_db():
    """Open a Neon connection, retrying transient outages.

    Neon is serverless and can be briefly unreachable (cold start / network
    blip). connect_timeout bounds each attempt; if the DB stays unreachable we
    skip this run (exit 0) rather than failing the job and emailing."""
    last_err = None
    for attempt in range(5):
        try:
            return psycopg2.connect(
                DATABASE_URL,
                connect_timeout=15,
                keepalives=1,
                keepalives_idle=30,
                keepalives_interval=10,
                keepalives_count=5,
            )
        except psycopg2.OperationalError as e:
            last_err = e
            print(f"DB connect failed (attempt {attempt + 1}/5): {e}")
            time.sleep(2 ** attempt + random.uniform(0, 1))
    print(
        f"Database unreachable after 5 attempts: {last_err}\n"
        "Skipping this run; the next scheduled run will catch up.",
        flush=True,
    )
    raise SystemExit(0)

def backfill():
    token = get_access_token()
    conn = connect_db()
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
