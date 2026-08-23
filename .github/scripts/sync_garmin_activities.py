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
name, sport_type and the summary polyline — the name is user-edited there and
only Strava has segments and the stored polyline.

Gear is filled in from Garmin when the row has none — see resolve_gear_id for
how a Garmin gear UUID is bound to the `gear` row Strava already created. An
assignment that is already there (from Strava, or edited in the app) is never
overwritten.

Usage:  python sync_garmin_activities.py [days] [gear_backfill]
        days          history to sync, default 14
        gear_backfill older Garmin-linked rides to fill gear on, default 25
"""

import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import garmin_common as gc  # noqa: E402

PROVIDER = "garmin"
DEFAULT_DAYS = 14
DEFAULT_GEAR_BACKFILL = 25
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


# ------------------------------------------------------------------ gear

def ensure_gear_schema(cur) -> None:
    """`gear.id` holds Strava's gear id, so a Garmin UUID needs its own column.
    The repo has no migration tooling — DDL is idempotent and runs inline."""
    cur.execute("ALTER TABLE gear ADD COLUMN IF NOT EXISTS garmin_uuid TEXT")
    # Garmin knows when each bike entered and left service. That window, not
    # the retired flag, is what decides whether a bike can be picked for a
    # given ride: a bike retired in 2023 is still the right answer for a 2022
    # ride and the wrong one for today's.
    cur.execute("ALTER TABLE gear ADD COLUMN IF NOT EXISTS date_begin DATE")
    cur.execute("ALTER TABLE gear ADD COLUMN IF NOT EXISTS date_end DATE")
    cur.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS gear_garmin_uuid_key "
        "ON gear (garmin_uuid) WHERE garmin_uuid IS NOT NULL"
    )


def gear_names(entry):
    """The names Garmin might carry for a bike, best first. `displayName` is
    often null — the athlete-typed name usually lands in `customMakeModel`,
    and make/model are the literal strings 'Other'/'Unknown Bike' unless the
    bike was picked from Garmin's catalogue."""
    out = []
    for key in ("displayName", "customMakeModel"):
        v = (entry.get(key) or "").strip()
        if v:
            out.append(v)
    make = (entry.get("gearMakeName") or "").strip()
    model = (entry.get("gearModelName") or "").strip()
    if make and model and make.lower() != "other" and "unknown" not in model.lower():
        out.append(f"{make} {model}")
    return out


def name_tokens(s):
    """(words, numbers) for a gear name. 'Gen 3 Levo' -> ({gen, levo}, {3}).

    They are scored differently on purpose. Words carry the identity and have
    to be contained one way or the other; numbers are the model year or size
    that one side usually omits — 'Crux 5' against 'Specialized Crux' — so a
    missing one cannot veto a match, but a shared one breaks a tie between
    'Turbo Levo' and 'Gen 3 Levo'. Single characters are dropped: they come
    from splitting 'S-Works' and 'EX-e' and match everything."""
    parts = [t for t in re.split(r"[^a-z0-9]+", (s or "").lower()) if len(t) >= 2 or t.isdigit()]
    words = {t for t in parts if not t.isdigit() and len(t) >= 2}
    numbers = {t for t in parts if t.isdigit()}
    return words, numbers


def match_gear_by_name(cur, names, exact_only=False):
    """Local gear id naming the same bike as this Garmin gear, or None.

    Garmin and Strava rarely agree on the exact string — 'Specialized Levo SL'
    against 'Levo SL', 'Stumpjumper' against 'Stumpjumper Evo' — so after an
    exact hit, a row matches when its words are contained in the Garmin name's
    words or vice versa. Plain word overlap is not enough: most of this fleet
    is a Levo of some kind, and overlap alone lets 'Specialized Levo SL' land
    on 'Levo 4'. Ties are broken by how much matched, and anything still
    ambiguous is refused rather than guessed — a wrong binding silently tags
    every future ride with the wrong bike, while no binding just leaves the
    gear to be set by hand, which is the situation today.

    Only rows not already bound to some other Garmin UUID are considered.
    """
    cur.execute("SELECT id, name, nickname FROM gear WHERE garmin_uuid IS NULL")
    rows = cur.fetchall()

    lowered = [n.strip().lower() for n in names]
    for gid, gname, nick in rows:
        for candidate in (gname, nick):
            if candidate and candidate.strip().lower() in lowered:
                return gid
    if exact_only:
        return None

    for name in names:
        gwords, gnums = name_tokens(name)
        if not gwords:
            continue
        hits = []
        for gid, gname, nick in rows:
            lwords, lnums = name_tokens(gname)
            nwords, nnums = name_tokens(nick)
            lwords, lnums = lwords | nwords, lnums | nnums
            if lwords and (lwords <= gwords or gwords <= lwords):
                hits.append((len(lwords & gwords) + len(lnums & gnums), gid))
        if not hits:
            continue
        top = max(score for score, _ in hits)
        winners = {gid for score, gid in hits if score == top}
        if len(winners) == 1:
            return winners.pop()
    return None


def gear_date(value):
    """Garmin sends '2023-08-19T02:01:34.0'; only the day matters here."""
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def sync_gear_status(cur, local_id, entry) -> None:
    """Mirror Garmin's service window and retirement onto a bound gear row.

    Both are Garmin's to own now: the `retired` flag arrived from Strava and
    the two had already drifted apart, and Strava has no concept of the dates
    at all. Retirement is only ever added, never cleared — some of the older
    bikes were marked in Strava and nowhere else."""
    begin, end = gear_date(entry.get("dateBegin")), gear_date(entry.get("dateEnd"))
    retired = (entry.get("gearStatusName") or "").lower() == "retired"
    cur.execute(
        """
        UPDATE gear
           SET date_begin = COALESCE(%s, date_begin),
               date_end   = COALESCE(%s, date_end),
               retired    = retired OR %s
         WHERE id = %s
           AND (date_begin IS DISTINCT FROM COALESCE(%s, date_begin)
             OR date_end   IS DISTINCT FROM COALESCE(%s, date_end)
             OR (%s AND retired IS DISTINCT FROM TRUE))
        """,
        (begin, end, retired, local_id, begin, end, retired),
    )
    if cur.rowcount:
        window = f"{begin or '?'} to {end or 'now'}"
        print(f"  gear updated: {local_id} ({window}{', retired' if retired else ''})")


def bind_gear(cur, uuid, local_id, label) -> bool:
    cur.execute(
        "UPDATE gear SET garmin_uuid = %s WHERE id = %s AND garmin_uuid IS NULL",
        (uuid, local_id),
    )
    if cur.rowcount:
        print(f"  gear bound: garmin {label} -> {local_id}")
    return bool(cur.rowcount)


def sync_gear_fleet(g, cur) -> int:
    """Bind the whole Garmin gear list to the `gear` rows Strava created.

    Done fleet-wide rather than one activity at a time so that every exact
    name match is claimed before any fuzzy one gets a look. Per-bike order
    otherwise decides the outcome: the retired 'Factor' entry reaches 'Factor
    One' by containment and takes it, and the entry actually named 'Factor
    ONE' then finds nothing left to match.

    Two API calls, and it settles after the first run — a bound row is
    skipped from then on.
    """
    try:
        pk = (g.get_user_profile() or {}).get("id")
        entries = (g.get_gear(pk) or []) if pk else []
    except Exception as e:
        print(f"  gear fleet unavailable: {e}")
        return 0

    pending = []
    for entry in entries:
        uuid = (entry.get("uuid") or "").strip()
        names = gear_names(entry)
        if not uuid or not names:
            continue
        cur.execute("SELECT id FROM gear WHERE garmin_uuid = %s", (uuid,))
        row = cur.fetchone()
        if row:
            sync_gear_status(cur, row[0], entry)
            continue
        pending.append((uuid, names, entry))

    bound = 0
    for exact_only in (True, False):
        for item in list(pending):
            uuid, names, entry = item
            local_id = match_gear_by_name(cur, names, exact_only=exact_only)
            if local_id and bind_gear(cur, uuid, local_id, names[0]):
                sync_gear_status(cur, local_id, entry)
                pending.remove(item)
                bound += 1
    # Whatever is left is either gear the app has never seen or a bike whose
    # names were too far apart to be sure about. Both are left alone: a row is
    # minted for it the first time an activity actually uses it, so retired
    # gear nobody rode never clutters the picker.
    return bound


def resolve_gear_id(cur, entry):
    """Local `gear.id` for a Garmin gear entry, creating the row if needed.

    Garmin identifies gear by UUID and Strava by 'b<number>', and the same
    bike exists in both. Binding them wrongly splits one bike's history in
    two, so the UUID is resolved in descending order of evidence:

      1. a binding already recorded on the gear row;
      2. a name match (see match_gear_by_name);
      3. otherwise treat it as gear the app has never seen and mint a row
         keyed 'g<uuid>', which cannot collide with Strava's ids.

    Only an unclaimed gear row is bound, so a UUID can never steal a bike
    already mapped to a different one. A bike that ends up duplicated because
    the two names were too far apart is visible in the gear list and fixable
    with one UPDATE; a UUID bound to the wrong bike is neither.
    """
    uuid = (entry.get("uuid") or "").strip()
    if not uuid:
        return None

    cur.execute("SELECT id FROM gear WHERE garmin_uuid = %s", (uuid,))
    row = cur.fetchone()
    if row:
        return row[0]

    names = gear_names(entry)
    local_id = match_gear_by_name(cur, names) if names else None

    if local_id and bind_gear(cur, uuid, local_id, names[0] if names else uuid):
        return local_id

    new_id = f"g{uuid}"
    name = names[0] if names else "Garmin gear"
    cur.execute(
        """
        INSERT INTO gear (id, name, nickname, retired, garmin_uuid, date_begin, date_end, synced_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (id) DO UPDATE SET garmin_uuid = EXCLUDED.garmin_uuid, synced_at = NOW()
        """,
        (new_id, name, name, (entry.get("gearStatusName") or "").lower() == "retired", uuid,
         gear_date(entry.get("dateBegin")), gear_date(entry.get("dateEnd"))),
    )
    print(f"  gear created: {name} ({new_id})")
    return new_id


def pick_gear_entry(entries, sport):
    """Garmin can return several pieces of gear for one activity (a bike and
    the shoes worn for the run leg). Take the bike for anything on wheels."""
    entries = [e for e in entries if isinstance(e, dict) and e.get("uuid")]
    if not entries:
        return None
    if "ride" in (sport or "").lower() or "bike" in (sport or "").lower():
        bikes = [e for e in entries if (e.get("gearTypeName") or "").lower() == "bike"]
        if bikes:
            return bikes[0]
        return None  # shoes on a ride are not this row's gear
    return entries[0]


def apply_gear(g, cur, internal_id, garmin_id, sport) -> bool:
    """Tag one activity with the gear Garmin recorded. Returns True if written.

    Costs one API call per activity, so callers only invoke it for rows that
    have no gear yet."""
    try:
        entries = g.get_activity_gear(garmin_id) or []
    except Exception as e:
        print(f"  gear lookup failed for {garmin_id}: {e}")
        return False

    entry = pick_gear_entry(entries, sport)
    if not entry:
        return False

    gear_id = resolve_gear_id(cur, entry)
    if not gear_id:
        return False

    cur.execute(
        "UPDATE activities SET gear_id = %s, updated_at = NOW() "
        "WHERE id = %s AND gear_id IS NULL",
        (gear_id, internal_id),
    )
    return cur.rowcount > 0


def backfill_gear(g, conn, cur, limit) -> int:
    """Fill gear on older Garmin-linked rides that never got any.

    Everything ridden before the app existed came in from Strava, and Strava
    only knows the bike if it was set there. Garmin has the gear for all of
    it, but at one request per activity the whole history cannot be done in a
    single run — so each scheduled run chips away at the newest untagged rides
    and the backlog drains on its own."""
    if limit <= 0:
        return 0
    cur.execute(
        """
        SELECT id, garmin_id, sport_type FROM activities
         WHERE garmin_id IS NOT NULL AND gear_id IS NULL
           AND (sport_type ILIKE '%%ride%%' OR sport_type ILIKE '%%bike%%')
         ORDER BY start_date DESC
         LIMIT %s
        """,
        (limit,),
    )
    filled = 0
    for internal_id, garmin_id, sport in cur.fetchall():
        try:
            if apply_gear(g, cur, int(internal_id), int(garmin_id), sport):
                filled += 1
            conn.commit()
        except Exception as e:
            conn.rollback()
            print(f"  gear backfill failed for {internal_id}: {e}")
    return filled


def assert_no_cross_provider_duplicates(cur) -> int:
    """The failure that is expensive to find late: one ride as two rows means
    double-counted TSS and phantom power PBs, and nothing errors.

    Scoped to rows this sync MINTED (source='garmin' with no strava_id) that sit
    on top of a Strava row. A merged row legitimately carries both ids, and the
    data already contains ~21 Strava-to-Strava duplicates from activities
    uploaded twice by different apps years ago — matching on garmin_id alone
    flagged those too, which would fail every run and make the check worthless.
    """
    cur.execute(
        """
        SELECT g.id, s.id, g.name, s.name
          FROM activities g JOIN activities s
            ON g.id <> s.id
           AND ABS(EXTRACT(EPOCH FROM (g.start_date - s.start_date))) < %s
           AND ABS(g.elapsed_time - s.elapsed_time) < %s
         WHERE g.source = 'garmin' AND g.strava_id IS NULL
           AND s.strava_id IS NOT NULL
        """,
        (MATCH_WINDOW_S, MATCH_WINDOW_S),
    )
    dupes = cur.fetchall()
    for d in dupes:
        print(f"  !! cross-provider duplicate: {d[0]} ({d[2]}) and {d[1]} ({d[3]})")
    return len(dupes)


def main() -> int:
    days = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DAYS
    gear_backfill = int(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_GEAR_BACKFILL
    try:
        with gc.garmin_session() as (g, conn, cur):
            if gc.primary_source(cur) != "garmin":
                print("Garmin ingest is off — primary source is Strava. Nothing to do.")
                gc.record_sync_health(cur, PROVIDER, True, detail="skipped: not primary")
                conn.commit()
                return 0

            ensure_gear_schema(cur)
            sync_gear_fleet(g, cur)
            conn.commit()
            ftp = gc.athlete_ftp(cur)
            # Garmin filters get_activities_by_date by the activity's LOCAL
            # date, but this window was computed in UTC. In Sydney (UTC+10) a
            # ride before 10:00 local carries a local date one day ahead of the
            # UTC date, so a morning ride sat outside the window — invisible to
            # every run until UTC caught up, up to ~14 hours later. Pad both
            # ends by a day; re-listing a already-synced day is idempotent.
            now = datetime.now(timezone.utc)
            start = (now - timedelta(days=days + 1)).date().isoformat()
            end = (now + timedelta(days=1)).date().isoformat()
            print(f"Syncing Garmin activities {start}..{end} (FTP {ftp:.0f})")

            acts = g.get_activities_by_date(start, end) or []
            counts = {"inserted": 0, "merged": 0, "tombstoned": 0, "skip": 0}
            geared = 0
            for a in acts:
                try:
                    outcome = upsert(cur, a, ftp)
                    counts[outcome] = counts.get(outcome, 0) + 1
                    if outcome in ("inserted", "merged"):
                        begin = a.get("beginTimestamp")
                        internal = None
                        cur.execute(
                            "SELECT id, gear_id FROM activities WHERE garmin_id = %s",
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
                            # Gear is a separate endpoint — the activity
                            # summary never carries it — so only ask for rows
                            # that still have none.
                            if r[1] is None and apply_gear(
                                g, cur, internal, int(a["activityId"]), sport_type(a),
                            ):
                                geared += 1
                        print(f"  {outcome:<10} {a.get('startTimeLocal')}  {a.get('activityName')}")
                    conn.commit()
                except Exception as e:
                    conn.rollback()
                    print(f"  FAILED {a.get('activityId')}: {e}")

            geared += backfill_gear(g, conn, cur, gear_backfill)

            dupes = assert_no_cross_provider_duplicates(cur)
            detail = (
                f"{counts['inserted']} new, {counts['merged']} merged, "
                f"{counts['tombstoned']} tombstoned, {geared} gear"
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
