#!/usr/bin/env python3
"""Sync Garmin activities into `activities`.

Only runs when Settings has Garmin as the primary source. Exactly one provider
writes activities at a time so a ride can never land twice and double-count TSS
into CTL/ATL/TSB.

Identity (mirrors lib/activity-identity.ts):
  • `activities.id` is a surrogate assigned once and never changed — six tables
    and a JSONB array join on it.
  • Garmin rows mint `1e15 + activityId`. Deterministic, so re-ingest is
    idempotent without a lookup, and safely inside Number.MAX_SAFE_INTEGER.
  • A ride already present from Strava is *matched and merged*, not duplicated:
    same start within ±120s and a duration within max(120s, 5%). Garmin's
    beginTimestamp is epoch-ms UTC and lines up with Strava's start_date to the
    second, so the window is generous rather than marginal.
  • Ambiguous matches are refused rather than guessed — a stray extra row is
    visible and fixable, silently welding two rides together is not.

Field ownership on a merged row: Garmin owns the measurements (power, HR,
elevation, durations, distance) because the FIT is ground truth. Strava keeps
name, sport_type, gear and the summary polyline — the name is user-edited there
and only Strava has segments and the stored polyline.

Usage:  python sync_garmin_activities.py [days]   (default 14)
"""

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import garmin_common as gc  # noqa: E402

PROVIDER = "garmin"
DEFAULT_DAYS = 14
GARMIN_ID_OFFSET = 1_000_000_000_000_000  # keep in sync with lib/activity-identity.ts
MATCH_WINDOW_S = 120

# Garmin typeKey -> the sport_type vocabulary already in `activities`, so
# existing analytics filters and sport breakdowns keep working unchanged.
SPORT_MAP = {
    "road_biking": "Ride",
    "cycling": "Ride",
    "indoor_cycling": "Ride",
    "virtual_ride": "Ride",
    "gravel_cycling": "GravelRide",
    "mountain_biking": "MountainBikeRide",
    "e_bike_mountain": "EMountainBikeRide",
    "e_bike_fitness": "EBikeRide",
    "cyclocross": "Ride",
    "running": "Run",
    "treadmill_running": "Run",
    "trail_running": "Run",
    "walking": "Walk",
    "casual_walking": "Walk",
    "speed_walking": "Walk",
    "hiking": "Hike",
    "lap_swimming": "Swim",
    "open_water_swimming": "Swim",
    "strength_training": "WeightTraining",
    "indoor_cardio": "Workout",
    "elliptical": "Elliptical",
}
TRAINER_KEYS = {"indoor_cycling", "virtual_ride", "treadmill_running", "indoor_cardio"}


def sport_type(a) -> str:
    key = (a.get("activityType") or {}).get("typeKey") or ""
    return SPORT_MAP.get(key, "Workout")


def num(v):
    return v if isinstance(v, (int, float)) else None


def calc_tss(moving_s, np_w, ftp):
    if not moving_s or not np_w or not ftp:
        return None
    intensity = np_w / ftp
    return round((moving_s * np_w * intensity) / (ftp * 3600) * 100, 1)


def calc_hrss(moving_s, avg_hr, lthr=173.0):
    """Mirrors calculateHrss in lib/strava-sync.ts."""
    if not moving_s or not avg_hr or avg_hr <= 0:
        return None
    return round((moving_s / 3600) * 100 * (avg_hr / lthr) ** 2)


def resolve_id(cur, garmin_id, start_utc, elapsed):
    """(internal_id, is_new). Mirrors resolveActivityId in TS."""
    cur.execute("SELECT id FROM activities WHERE garmin_id = %s", (garmin_id,))
    row = cur.fetchone()
    if row:
        return int(row[0]), False

    cur.execute(
        """
        SELECT id, elapsed_time FROM activities
         WHERE ABS(EXTRACT(EPOCH FROM (start_date - %s::timestamptz))) <= %s
           AND garmin_id IS NULL
         ORDER BY start_date
        """,
        (start_utc.isoformat(), MATCH_WINDOW_S),
    )
    candidates = cur.fetchall()
    viable = [
        r for r in candidates
        if elapsed is None or r[1] is None
        or abs(r[1] - elapsed) <= max(MATCH_WINDOW_S, r[1] * 0.05)
    ]
    if len(viable) > 1:
        print(
            f"  ambiguous: {len(viable)} candidates for garmin {garmin_id} at "
            f"{start_utc.isoformat()} — refusing to merge, creating a new row"
        )
        viable = []
    if len(viable) == 1:
        internal = int(viable[0][0])
        cur.execute("UPDATE activities SET garmin_id = %s WHERE id = %s", (garmin_id, internal))
        return internal, False

    return GARMIN_ID_OFFSET + garmin_id, True


def tombstoned(cur, internal_id, garmin_id, start_utc) -> bool:
    try:
        cur.execute(
            """
            SELECT 1 FROM deleted_activities
             WHERE id = %s OR garmin_id = %s
                OR (start_date IS NOT NULL
                    AND ABS(EXTRACT(EPOCH FROM (start_date - %s::timestamptz))) <= %s)
             LIMIT 1
            """,
            (internal_id, garmin_id, start_utc.isoformat(), MATCH_WINDOW_S),
        )
        return cur.fetchone() is not None
    except Exception:
        return False


def deletion_flags(cur, internal_id):
    try:
        cur.execute(
            "SELECT power_deleted, hr_deleted FROM activities WHERE id = %s", (internal_id,)
        )
        row = cur.fetchone()
        return (bool(row[0]), bool(row[1])) if row else (False, False)
    except Exception:
        return (False, False)


def upsert(cur, a, ftp) -> str:
    garmin_id = int(a["activityId"])
    begin = a.get("beginTimestamp")
    if not begin:
        return "skip"
    start_utc = datetime.fromtimestamp(begin / 1000, timezone.utc)

    elapsed = int(num(a.get("elapsedDuration")) or num(a.get("duration")) or 0) or None
    moving = int(num(a.get("movingDuration")) or num(a.get("duration")) or 0) or None

    internal_id, is_new = resolve_id(cur, garmin_id, start_utc, elapsed)

    if tombstoned(cur, internal_id, garmin_id, start_utc):
        return "tombstoned"

    # Channels deleted in-app must not be resurrected by a Garmin re-sync.
    power_deleted, hr_deleted = (False, False) if is_new else deletion_flags(cur, internal_id)

    avg_w = None if power_deleted else num(a.get("avgPower"))
    max_w = None if power_deleted else num(a.get("maxPower"))
    np_w = None if power_deleted else num(a.get("normPower"))
    avg_hr = None if hr_deleted else num(a.get("averageHR"))
    max_hr = None if hr_deleted else num(a.get("maxHR"))

    # TSS is computed locally rather than taking Garmin's trainingStressScore:
    # Garmin uses its own FTP setting, and 3800+ historical rows were computed
    # from the app's effectiveFtp(). Consistency of the CTL/ATL series matters
    # more than Garmin's number. Garmin's device-measured normPower makes the
    # local result better than Strava's estimate anyway.
    hrss = calc_hrss(moving, avg_hr) if (not np_w and avg_hr) else None
    tss = calc_tss(moving, np_w, ftp) if np_w else hrss
    if_val = round(np_w / ftp, 3) if np_w and ftp else None
    kj = round(avg_w * moving / 1000) if avg_w and moving else None

    key = (a.get("activityType") or {}).get("typeKey") or ""
    values = {
        "start_date": start_utc,
        "elapsed_time": elapsed,
        "moving_time": moving,
        "distance": num(a.get("distance")),
        "total_elevation_gain": num(a.get("elevationGain")),
        "average_watts": avg_w,
        "weighted_average_watts": np_w,
        "normalized_power": np_w,
        "max_watts": max_w,
        "kilojoules": kj,
        "average_heartrate": avg_hr,
        "max_heartrate": max_hr,
        "average_speed": num(a.get("averageSpeed")),
        "tss": tss,
        "hrss": hrss,
        "intensity_factor": if_val,
        "garmin_id": garmin_id,
    }

    if is_new:
        # Strava-owned fields are only set when we create the row; a later
        # Strava sync would overwrite them with the authoritative values.
        values["name"] = a.get("activityName")
        values["sport_type"] = sport_type(a)
        values["trainer"] = key in TRAINER_KEYS
        values["source"] = "garmin"
        cols = list(values)
        cur.execute(
            f"INSERT INTO activities (id, {', '.join(cols)}) "
            f"VALUES (%s, {', '.join(['%s'] * len(cols))}) "
            f"ON CONFLICT (id) DO NOTHING",
            [internal_id] + [values[c] for c in cols],
        )
        return "inserted"

    # Merge onto an existing row: Garmin owns the measurements only.
    cols = list(values)
    cur.execute(
        f"UPDATE activities SET {', '.join(f'{c} = %s' for c in cols)}, updated_at = NOW() "
        f"WHERE id = %s",
        [values[c] for c in cols] + [internal_id],
    )
    return "merged"


def write_power_curve(cur, internal_id, a, start_utc, sport):
    """Garmin ships maxAvgPower_N on the summary, so a Garmin-only ride still
    appears in the power curve without downloading any streams."""
    rows = []
    for secs in (1, 5, 10, 30, 60, 300, 600, 1200, 1800, 3600):
        w = num(a.get(f"maxAvgPower_{secs}"))
        if w:
            rows.append((internal_id, secs, int(w), start_utc, sport))
    if not rows:
        return 0
    try:
        cur.executemany(
            """
            INSERT INTO best_power_efforts (activity_id, seconds, best_watts, start_date, sport_type)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (activity_id, seconds) DO UPDATE SET best_watts = EXCLUDED.best_watts
            """,
            rows,
        )
        return len(rows)
    except Exception as e:
        print(f"  power curve skipped: {e}")
        return 0


def assert_no_cross_provider_duplicates(cur) -> int:
    """The failure that is expensive to find late: one ride as two rows means
    double-counted TSS and phantom power PBs, and nothing errors.

    Scoped to cross-provider pairs on purpose — the data already contains ~21
    Strava-to-Strava duplicates from activities uploaded twice by different
    apps years ago, which are not this sync's doing.
    """
    cur.execute(
        """
        SELECT a.id, b.id, a.name, b.name
          FROM activities a JOIN activities b
            ON a.id < b.id
           AND ABS(EXTRACT(EPOCH FROM (a.start_date - b.start_date))) < %s
           AND ABS(a.elapsed_time - b.elapsed_time) < %s
         WHERE (a.garmin_id IS NOT NULL AND b.strava_id IS NOT NULL AND b.garmin_id IS NULL)
            OR (b.garmin_id IS NOT NULL AND a.strava_id IS NOT NULL AND a.garmin_id IS NULL)
        """,
        (MATCH_WINDOW_S, MATCH_WINDOW_S),
    )
    dupes = cur.fetchall()
    for d in dupes:
        print(f"  !! cross-provider duplicate: {d[0]} ({d[2]}) and {d[1]} ({d[3]})")
    return len(dupes)


def main() -> int:
    days = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DAYS
    try:
        with gc.garmin_session() as (g, conn, cur):
            if gc.primary_source(cur) != "garmin":
                print("Garmin ingest is off — primary source is Strava. Nothing to do.")
                gc.record_sync_health(cur, PROVIDER, True, detail="skipped: not primary")
                conn.commit()
                return 0

            ftp = gc.athlete_ftp(cur)
            start = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()
            end = datetime.now(timezone.utc).date().isoformat()
            print(f"Syncing Garmin activities {start}..{end} (FTP {ftp:.0f})")

            acts = g.get_activities_by_date(start, end) or []
            counts = {"inserted": 0, "merged": 0, "tombstoned": 0, "skip": 0}
            for a in acts:
                try:
                    outcome = upsert(cur, a, ftp)
                    counts[outcome] = counts.get(outcome, 0) + 1
                    if outcome in ("inserted", "merged"):
                        begin = a.get("beginTimestamp")
                        internal = None
                        cur.execute(
                            "SELECT id FROM activities WHERE garmin_id = %s",
                            (int(a["activityId"]),),
                        )
                        r = cur.fetchone()
                        if r:
                            internal = int(r[0])
                            write_power_curve(
                                cur, internal, a,
                                datetime.fromtimestamp(begin / 1000, timezone.utc),
                                sport_type(a),
                            )
                        print(f"  {outcome:<10} {a.get('startTimeLocal')}  {a.get('activityName')}")
                    conn.commit()
                except Exception as e:
                    conn.rollback()
                    print(f"  FAILED {a.get('activityId')}: {e}")

            dupes = assert_no_cross_provider_duplicates(cur)
            detail = (
                f"{counts['inserted']} new, {counts['merged']} merged, "
                f"{counts['tombstoned']} tombstoned"
            )
            gc.record_sync_health(cur, PROVIDER, dupes == 0, detail=detail,
                                  error=None if dupes == 0 else f"{dupes} cross-provider duplicates")
            conn.commit()
            print(f"Done. {detail}. Cross-provider duplicates: {dupes}")
            if dupes:
                return 1
    except gc.ReauthRequired as e:
        gc.bail_on_reauth(e)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
