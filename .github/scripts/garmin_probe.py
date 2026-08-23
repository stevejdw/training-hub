#!/usr/bin/env python3
"""Read-only Garmin connectivity check. Writes nothing to activities or wellness.

Two jobs:

  1. Prove, once, that CI can resume the token bundle deposited by
     `npm run garmin:login` — before any schema change depends on it.

  2. Stay around as the diagnostic to run *before* bumping the pinned
     garminconnect version, and the first thing to run when a scheduled Garmin
     job starts failing. Garmin breaks the unofficial SSO flow roughly
     annually; having a dispatchable probe means you find out which layer broke
     without editing a live sync job.

The only table it touches is connected_accounts (token refresh + last_ok_at).
"""

import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import garmin_common as gc  # noqa: E402


def show(label, value):
    print(f"  {label:.<34} {value}")


def probe(garmin) -> None:
    today = date.today().isoformat()
    yesterday = (date.today() - timedelta(days=1)).isoformat()

    print(f"\nAuthenticated as: {garmin.get_full_name()}")

    print("\nLast 5 activities:")
    try:
        activities = garmin.get_activities(0, 5)
        if not activities:
            print("  (none returned)")
        for a in activities:
            print(
                f"  {a.get('startTimeLocal', '?')}  "
                f"{(a.get('activityType') or {}).get('typeKey', '?'):<18} "
                f"{a.get('activityName', '?')}  "
                f"[garmin id {a.get('activityId')}]"
            )
    except Exception as e:
        print(f"  FAILED: {e}")

    # Wellness metrics are the Phase 3 payload — confirm each endpoint answers
    # before building a sync around it. Garmin returns empty for a day the
    # watch hasn't synced yet, so fall back to yesterday rather than crying
    # wolf on an early-morning run.
    print("\nWellness (today, falling back to yesterday):")

    def first_ok(fn, *dates):
        for d in dates:
            try:
                result = fn(d)
                if result:
                    return result, d
            except Exception as e:
                return f"FAILED: {e}", d
        return None, dates[-1]

    tr, d = first_ok(garmin.get_training_readiness, today, yesterday)
    if isinstance(tr, list) and tr:
        show(f"Training Readiness ({d})", f"{tr[0].get('score')}  {tr[0].get('level')}")
    else:
        show(f"Training Readiness ({d})", tr or "(no data)")

    ts, d = first_ok(garmin.get_training_status, today, yesterday)
    if isinstance(ts, dict):
        show(f"Training Status ({d})", ts.get("latestTrainingStatusData") and "present" or "(empty)")
    else:
        show(f"Training Status ({d})", ts or "(no data)")

    try:
        bb = garmin.get_body_battery(yesterday, today)
        if bb:
            levels = [
                v[2]
                for day in bb
                for v in (day.get("bodyBatteryValuesArray") or [])
                if len(v) > 2 and isinstance(v[2], (int, float))
            ]
            show("Body Battery (high/low)", f"{max(levels)}/{min(levels)}" if levels else "(no samples)")
        else:
            show("Body Battery", "(no data)")
    except Exception as e:
        show("Body Battery", f"FAILED: {e}")

    hrv, d = first_ok(garmin.get_hrv_data, today, yesterday)
    if isinstance(hrv, dict):
        summary = hrv.get("hrvSummary") or {}
        show(f"HRV ({d})", f"{summary.get('lastNightAvg')} ms  status={summary.get('status')}")
    else:
        show(f"HRV ({d})", hrv or "(no data)")

    sleep, d = first_ok(garmin.get_sleep_data, today, yesterday)
    if isinstance(sleep, dict):
        dto = sleep.get("dailySleepDTO") or {}
        show(f"Sleep ({d})", f"{(dto.get('sleepTimeSeconds') or 0) / 3600:.1f} h  score={(dto.get('sleepScores') or {}).get('overall', {}).get('value')}")
    else:
        show(f"Sleep ({d})", sleep or "(no data)")

    vo2, d = first_ok(garmin.get_max_metrics, today, yesterday)
    if isinstance(vo2, list) and vo2:
        generic = (vo2[0].get("generic") or {})
        show(f"VO2max ({d})", generic.get("vo2MaxPreciseValue") or generic.get("vo2MaxValue") or "(no data)")
    else:
        show(f"VO2max ({d})", vo2 or "(no data)")


def probe_gear(garmin) -> None:
    """Gear payload shape, so the activity sync can map Garmin gear onto the
    `gear` rows Strava already created rather than duplicating every bike."""
    print("\nGear on the last 5 activities:")
    try:
        activities = garmin.get_activities(0, 5)
    except Exception as e:
        print(f"  FAILED listing activities: {e}")
        return
    for a in activities or []:
        aid = a.get("activityId")
        try:
            gear = garmin.get_activity_gear(aid)
        except Exception as e:
            print(f"  {aid}: FAILED: {e}")
            continue
        if not gear:
            print(f"  {aid}  {a.get('activityName')}: (no gear)")
            continue
        for g in gear:
            print(f"  {aid}  {a.get('activityName')}: {g}")


def main() -> int:
    try:
        with gc.garmin_session() as (garmin, _conn, _cur):
            probe(garmin)
            probe_gear(garmin)
    except gc.ReauthRequired as e:
        gc.bail_on_reauth(e)

    print("\nProbe complete — no activity or wellness rows were written.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
