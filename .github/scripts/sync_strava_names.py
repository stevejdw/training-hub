#!/usr/bin/env python3
"""Adopt Strava activity names onto Garmin-sourced rides.

Garmin names rides after the device profile ("Sydney - 60/30's"); Strava is
where they get renamed to something meaningful ("V02 60/30s + 10 min
threshold"). The field-ownership rule already says Strava owns the name, but
with Garmin as the primary source the Strava sync never runs, so that rule
never got a chance to apply.

This reads names only. It creates nothing, deletes nothing, and touches no
metric — Garmin remains the source of truth for everything measured.

It also backfills `strava_id` onto matched rows, which makes the next run an
exact-id lookup instead of a time-window match.

Only runs when Garmin is primary; with Strava primary the normal sync already
carries the name.

Usage:  python sync_strava_names.py [days]   (default 30)
"""

import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))

import garmin_common as gc  # noqa: E402

PROVIDER = "strava-names"
DEFAULT_DAYS = 30
MATCH_WINDOW_S = 120

# Strava auto-names an activity by time of day and sport ("Morning Ride",
# "Morning activity", "Lunch Ride"). Those are not renames, and adopting them
# destroys a better name already on the row — the first run of this script
# replaced "NBD - Crux 5" with "Morning activity". Only a name that does not
# match this shape counts as something the athlete actually chose.
import re as _re

_GENERIC_NAME = _re.compile(
    r"^(morning|afternoon|evening|night|lunch|midday)\s+"
    r"(ride|run|walk|swim|hike|activity|workout|weight\s*training|"
    r"e-?bike\s*ride|mountain\s*bike\s*ride|gravel\s*ride|virtual\s*ride|"
    r"elliptical|rowing|yoga|training)$",
    _re.IGNORECASE,
)


def is_generic(name: str) -> bool:
    """True when Strava generated the name rather than the athlete."""
    return bool(_GENERIC_NAME.match((name or "").strip()))


def get_refresh_token(cur) -> str:
    """Mirrors getRefreshToken() in lib/strava-sync.ts: the rotating token in
    the database is authoritative, the env var is only a stale fallback."""
    try:
        cur.execute("SELECT refresh_token FROM strava_tokens WHERE id = 1 LIMIT 1")
        row = cur.fetchone()
        if row and row[0]:
            return row[0]
    except Exception:
        pass
    return os.environ.get("STRAVA_REFRESH_TOKEN", "")


def get_access_token(conn, cur):
    """Exchange the refresh token, persisting rotation back to the database so
    the next run doesn't fail the way a stale GitHub secret would."""
    refresh = get_refresh_token(cur)
    if not refresh:
        print("No Strava refresh token available — skipping.")
        return None
    client_id = (os.environ.get("STRAVA_CLIENT_ID") or "").strip()
    client_secret = (os.environ.get("STRAVA_CLIENT_SECRET") or "").strip()
    if not client_id or not client_secret:
        print("STRAVA_CLIENT_ID/SECRET not set — skipping.")
        return None

    for attempt in range(3):
        r = requests.post(
            "https://www.strava.com/oauth/token",
            data={"client_id": client_id, "client_secret": client_secret,
                  "refresh_token": refresh, "grant_type": "refresh_token"},
            timeout=30,
        )
        if r.status_code == 200:
            d = r.json()
            new_refresh = d.get("refresh_token")
            if new_refresh and new_refresh != refresh:
                cur.execute(
                    "UPDATE strava_tokens SET refresh_token = %s, updated_at = NOW() WHERE id = 1",
                    (new_refresh,),
                )
                conn.commit()
                print("Strava rotated the refresh token — persisted to the database.")
            return d.get("access_token")
        if r.status_code == 401:
            print("Strava refused the refresh token (401). Reconnect Strava in Settings.")
            return None
        time.sleep(2 ** attempt)
    print(f"Strava token refresh failed after retries (HTTP {r.status_code}).")
    return None


def main() -> int:
    days = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DAYS
    conn = gc.connect_db()
    cur = conn.cursor()
    try:
        if gc.primary_source(cur) != "garmin":
            print("Strava is the primary source — it already supplies names. Nothing to do.")
            return 0

        token = get_access_token(conn, cur)
        if not token:
            gc.record_sync_health(cur, PROVIDER, False, error="no Strava access token")
            conn.commit()
            return 0

        after = int((datetime.now(timezone.utc) - timedelta(days=days)).timestamp())
        r = requests.get(
            "https://www.strava.com/api/v3/athlete/activities",
            headers={"Authorization": f"Bearer {token}"},
            params={"after": after, "per_page": 100},
            timeout=30,
        )
        if r.status_code != 200:
            print(f"Strava activity list failed: HTTP {r.status_code}")
            gc.record_sync_health(cur, PROVIDER, False, error=f"list HTTP {r.status_code}")
            conn.commit()
            return 0

        renamed = 0
        linked = 0
        for a in r.json():
            name = (a.get("name") or "").strip()
            strava_id = a.get("id")
            start = a.get("start_date")
            if not name or not strava_id or not start:
                continue

            # Exact id first; otherwise the same start/duration match the
            # dedup uses, so a Garmin-minted row still gets found.
            cur.execute("SELECT id, name FROM activities WHERE strava_id = %s", (strava_id,))
            row = cur.fetchone()
            if not row:
                cur.execute(
                    """
                    SELECT id, name FROM activities
                     WHERE ABS(EXTRACT(EPOCH FROM (start_date - %s::timestamptz))) <= %s
                       AND (strava_id IS NULL OR strava_id = %s)
                       AND (%s IS NULL OR elapsed_time IS NULL
                            OR ABS(elapsed_time - %s) <= GREATEST(%s, elapsed_time * 0.05))
                     ORDER BY ABS(EXTRACT(EPOCH FROM (start_date - %s::timestamptz)))
                     LIMIT 2
                    """,
                    (start, MATCH_WINDOW_S, strava_id,
                     a.get("elapsed_time"), a.get("elapsed_time"), MATCH_WINDOW_S, start),
                )
                rows = cur.fetchall()
                if len(rows) != 1:
                    continue  # none, or ambiguous — leave it alone
                row = rows[0]
                cur.execute(
                    "UPDATE activities SET strava_id = %s WHERE id = %s AND strava_id IS NULL",
                    (strava_id, row[0]),
                )
                linked += 1

            if is_generic(name):
                # Strava's default. Whatever is on the row — Garmin's device
                # name, or a name adopted earlier — is at least as good.
                continue

            if (row[1] or "").strip() != name:
                cur.execute(
                    "UPDATE activities SET name = %s, updated_at = NOW() WHERE id = %s",
                    (name, row[0]),
                )
                print(f"  renamed: {row[1]!r} -> {name!r}")
                renamed += 1

        conn.commit()
        gc.record_sync_health(cur, PROVIDER, True, detail=f"{renamed} renamed, {linked} linked")
        conn.commit()
        print(f"Done. {renamed} renamed, {linked} newly linked to a Strava id.")
    finally:
        cur.close()
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
