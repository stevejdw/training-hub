#!/usr/bin/env python3
"""Backfill historical VO2max from Garmin Connect into daily_wellness.

sync_garmin_wellness.py only ever walks back from today, so VO2max exists only
from the day that job first ran (2026-07-18). Everything earlier had to be
estimated from best 5-min power in the eFTP chart. This fills the gap with
Garmin's own numbers.

Two things make this a separate script rather than `garmin-wellness.yml` with a
big `days` input:

  1. That job makes ~7 API calls per day of history. A two-year backfill would
     be ~5000 requests against an unofficial API — a good way to get the
     account rate-limited. Garmin's maxmet endpoint accepts a *date range*, so
     the same two years costs ~26 requests here.

  2. It writes only the two VO2max columns. A full wellness backfill would
     stamp source='garmin' across historical rows that intervals.icu owns,
     which would then make the intervals writers skip them forever (see the
     precedence note in sync_garmin_wellness.py). On conflict this leaves
     `source` exactly as it found it.

Usage:  python backfill_garmin_vo2.py [days]      (default 730)
"""

import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import garmin_common as gc  # noqa: E402
from sync_garmin_wellness import ensure_schema  # noqa: E402

DEFAULT_DAYS = 730
CHUNK_DAYS = 28   # Garmin 500s on very long ranges; 28 is comfortably inside.
PER_DAY_SLEEP = 0.35  # Unofficial API — pace the per-day fallback.


def _num(v):
    return v if isinstance(v, (int, float)) else None


def _entry_values(entry: dict) -> tuple[float | None, float | None]:
    gen = entry.get("generic") or {}
    cyc = entry.get("cycling") or {}
    return (
        _num(gen.get("vo2MaxPreciseValue")) or _num(gen.get("vo2MaxValue")),
        _num(cyc.get("vo2MaxPreciseValue")) or _num(cyc.get("vo2MaxValue")),
    )


def fetch_range(g, start: str, end: str) -> dict[str, tuple]:
    """{date: (vo2max, vo2max_cycling)} for a date range, one request.

    garminconnect's get_max_metrics() hardcodes cdate for both ends of the
    path, so go at the endpoint directly to get a range out of it. Falls back
    to per-day calls if Garmin rejects the wider window.
    """
    out: dict[str, tuple] = {}
    try:
        data = g.connectapi(f"/metrics-service/metrics/maxmet/daily/{start}/{end}")
    except Exception as e:
        print(f"  range {start}..{end} failed ({e}) — falling back to per-day")
        return fetch_per_day(g, start, end)

    for entry in data or []:
        day = entry.get("calendarDate")
        if not day:
            continue
        vo2, cyc = _entry_values(entry)
        if vo2 is not None or cyc is not None:
            out[day] = (vo2, cyc)

    # An empty 200 is not proof the days are empty. Garmin answers the range
    # form happily and returns [] whenever start != end, so a silent zero here
    # looks identical to "no VO2max recorded" — and the first run of this
    # script wrote nothing for two years on exactly that. Treat empty as
    # unsupported and pay for the per-day walk.
    if not out:
        print(f"  range {start}..{end} returned nothing — falling back to per-day")
        return fetch_per_day(g, start, end)
    return out


def fetch_per_day(g, start: str, end: str) -> dict[str, tuple]:
    out: dict[str, tuple] = {}
    d, last = date.fromisoformat(start), date.fromisoformat(end)
    while d <= last:
        day = d.isoformat()
        try:
            data = g.get_max_metrics(day) or []
            if data:
                vo2, cyc = _entry_values(data[0])
                if vo2 is not None or cyc is not None:
                    out[day] = (vo2, cyc)
        except Exception as e:
            print(f"    {day}: {e}")
        time.sleep(PER_DAY_SLEEP)
        d += timedelta(days=1)
    return out


def probe(g, start: str, end: str) -> None:
    """Dump raw payloads for the range and single-day forms, and exit.

    Kept because the failure that motivated it is invisible: both forms return
    200, and only the bodies differ."""
    print(f"RANGE {start}..{end}:")
    try:
        print(json.dumps(g.connectapi(f"/metrics-service/metrics/maxmet/daily/{start}/{end}"), indent=1)[:1200])
    except Exception as e:
        print(f"  failed: {e}")
    for day in (start, end):
        print(f"\nSINGLE {day}:")
        try:
            print(json.dumps(g.get_max_metrics(day), indent=1)[:1200])
        except Exception as e:
            print(f"  failed: {e}")


def write(cur, day: str, vo2, cyc) -> None:
    """Insert or update the two VO2max columns and nothing else.

    `source` is set only on insert. Updating it would hand ownership of a
    historical row to Garmin on the strength of one metric, and the
    intervals.icu writers would then refuse to touch that day's HRV or sleep.
    """
    cur.execute(
        """
        INSERT INTO daily_wellness (date, vo2max, vo2max_cycling, source, synced_at)
        VALUES (%s, %s, %s, 'garmin', NOW())
        ON CONFLICT (date) DO UPDATE SET
          vo2max         = COALESCE(EXCLUDED.vo2max, daily_wellness.vo2max),
          vo2max_cycling = COALESCE(EXCLUDED.vo2max_cycling, daily_wellness.vo2max_cycling),
          synced_at      = NOW()
        """,
        (day, vo2, cyc),
    )


def main() -> int:
    if len(sys.argv) > 3 and sys.argv[1] == "--probe":
        try:
            with gc.garmin_session() as (g, conn, cur):
                probe(g, sys.argv[2], sys.argv[3])
        except gc.ReauthRequired as e:
            gc.bail_on_reauth(e)
        return 0

    days = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DAYS
    today = date.today()
    start = today - timedelta(days=days)

    try:
        with gc.garmin_session() as (g, conn, cur):
            ensure_schema(cur)
            conn.commit()

            cur.execute("SELECT COUNT(vo2max) FROM daily_wellness")
            before = cur.fetchone()[0]

            written = 0
            chunk_start = start
            while chunk_start <= today:
                chunk_end = min(chunk_start + timedelta(days=CHUNK_DAYS - 1), today)
                found = fetch_range(g, chunk_start.isoformat(), chunk_end.isoformat())
                for day, (vo2, cyc) in sorted(found.items()):
                    write(cur, day, vo2, cyc)
                    written += 1
                conn.commit()
                print(f"  {chunk_start} .. {chunk_end}: {len(found)} days")
                chunk_start = chunk_end + timedelta(days=1)

            cur.execute("SELECT COUNT(vo2max), MIN(date), MAX(date) FROM daily_wellness WHERE vo2max IS NOT NULL")
            after, oldest, newest = cur.fetchone()
            conn.commit()

            print(f"\nDone. {written} days written.")
            print(f"VO2max rows: {before} -> {after}, covering {oldest} .. {newest}")
    except gc.ReauthRequired as e:
        gc.bail_on_reauth(e)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
