#!/usr/bin/env python3
"""Sync Garmin wellness into daily_wellness.

Garmin is the first-party source for everything here — HRV, sleep, resting HR,
Body Battery, Training Readiness, Training Status and VO2max all originate on
the watch. intervals.icu re-serves a thin subset of the same data, so where
both exist Garmin wins; the precedence is enforced by the intervals.icu writers
skipping any row whose source is already 'garmin' (see
app/api/intervals/sync/route.ts), which keeps every read path a plain SELECT.

Garmin has no TSS, so `icu_tss` is never written here — the column stays owned
by intervals.icu and the fitness route keeps preferring it. Columns are listed
explicitly rather than swept with EXCLUDED.* precisely so this can't null it.

Usage:  python sync_garmin_wellness.py [days]      (default 7)
"""

import json
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import garmin_common as gc  # noqa: E402

DEFAULT_DAYS = 7

# Mirrors ensureWellnessSchema() in lib/wellness-schema.ts. The repo has no
# migration tooling — all DDL is idempotent and runs inline.
COLUMNS = [
    ("body_battery_high", "SMALLINT"),
    ("body_battery_low", "SMALLINT"),
    ("body_battery_charged", "SMALLINT"),
    ("body_battery_drained", "SMALLINT"),
    ("training_readiness", "SMALLINT"),
    ("training_readiness_level", "TEXT"),
    ("recovery_time_mins", "INT"),
    ("training_status", "TEXT"),
    ("training_status_sport", "TEXT"),
    ("acute_load", "INT"),
    ("chronic_load", "INT"),
    ("acwr", "FLOAT"),
    ("vo2max", "FLOAT"),
    ("vo2max_cycling", "FLOAT"),
    ("hrv_status", "TEXT"),
    ("hrv_weekly_avg", "SMALLINT"),
    ("sleep_deep_secs", "INT"),
    ("sleep_light_secs", "INT"),
    ("sleep_rem_secs", "INT"),
    ("sleep_awake_secs", "INT"),
    ("stress_avg", "SMALLINT"),
    ("respiration_avg", "FLOAT"),
    ("spo2_avg", "SMALLINT"),
]


def ensure_schema(cur):
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS daily_wellness (
          date            DATE PRIMARY KEY,
          hrv_rmssd       FLOAT,
          hrv_sdnn        FLOAT,
          resting_hr      INT,
          sleep_score     INT,
          readiness_score INT,
          sleep_secs      INT,
          icu_tss         DOUBLE PRECISION,
          source          TEXT DEFAULT 'intervals',
          synced_at       TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )
    for name, typ in COLUMNS:
        cur.execute(f"ALTER TABLE daily_wellness ADD COLUMN IF NOT EXISTS {name} {typ}")
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS daily_wellness_raw (
          date      DATE PRIMARY KEY,
          payload   JSONB,
          synced_at TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )


# ---------------------------------------------------------------- extraction
#
# Every getter is defensive: Garmin returns partial or empty documents for a
# day the watch hasn't finished syncing, and a missing metric must leave the
# column NULL rather than abort the day.

def _num(v):
    return v if isinstance(v, (int, float)) else None


def fetch_day(g, day: str) -> tuple[dict, dict]:
    out, raw = {}, {}

    try:
        tr = g.get_training_readiness(day) or []
        if tr:
            r = tr[0]
            raw["training_readiness"] = r
            out["training_readiness"] = _num(r.get("score"))
            out["training_readiness_level"] = r.get("level")
            out["recovery_time_mins"] = _num(r.get("recoveryTime"))
            out["hrv_weekly_avg"] = _num(r.get("hrvWeeklyAverage"))
            out["sleep_score"] = _num(r.get("sleepScore"))
    except Exception as e:
        print(f"  {day}: training_readiness failed: {e}")

    try:
        ts = g.get_training_status(day) or {}
        latest = (ts.get("mostRecentTrainingStatus") or {}).get("latestTrainingStatusData") or {}
        # Keyed by device id; prefer the primary training device.
        entries = list(latest.values())
        entry = next((e for e in entries if e.get("primaryTrainingDevice")), entries[0] if entries else None)
        if entry:
            raw["training_status"] = entry
            out["training_status"] = entry.get("trainingStatusFeedbackPhrase")
            out["training_status_sport"] = entry.get("sport")
            load = entry.get("acuteTrainingLoadDTO") or {}
            out["acute_load"] = _num(load.get("dailyTrainingLoadAcute"))
            out["chronic_load"] = _num(load.get("dailyTrainingLoadChronic"))
            out["acwr"] = _num(load.get("dailyAcuteChronicWorkloadRatio"))
        vo2 = ts.get("mostRecentVO2Max") or {}
        gen, cyc = vo2.get("generic") or {}, vo2.get("cycling") or {}
        out["vo2max"] = _num(gen.get("vo2MaxPreciseValue")) or _num(gen.get("vo2MaxValue"))
        out["vo2max_cycling"] = _num(cyc.get("vo2MaxPreciseValue")) or _num(cyc.get("vo2MaxValue"))
    except Exception as e:
        print(f"  {day}: training_status failed: {e}")

    try:
        bb = g.get_body_battery(day, day) or []
        if bb:
            d = bb[0]
            out["body_battery_charged"] = _num(d.get("charged"))
            out["body_battery_drained"] = _num(d.get("drained"))
            # Descriptors confirm [0]=timestamp, [1]=bodyBatteryLevel, and the
            # level is None for samples the watch didn't record.
            levels = [
                v[1] for v in (d.get("bodyBatteryValuesArray") or [])
                if len(v) > 1 and isinstance(v[1], (int, float))
            ]
            if levels:
                out["body_battery_high"] = max(levels)
                out["body_battery_low"] = min(levels)
    except Exception as e:
        print(f"  {day}: body_battery failed: {e}")

    try:
        hrv = g.get_hrv_data(day) or {}
        s = hrv.get("hrvSummary") or {}
        if s:
            raw["hrv"] = s
            out["hrv_rmssd"] = _num(s.get("lastNightAvg"))
            out["hrv_status"] = s.get("status")
    except Exception as e:
        print(f"  {day}: hrv failed: {e}")

    try:
        sleep = g.get_sleep_data(day) or {}
        dto = sleep.get("dailySleepDTO") or {}
        if dto:
            out["sleep_secs"] = _num(dto.get("sleepTimeSeconds"))
            out["sleep_deep_secs"] = _num(dto.get("deepSleepSeconds"))
            out["sleep_light_secs"] = _num(dto.get("lightSleepSeconds"))
            out["sleep_rem_secs"] = _num(dto.get("remSleepSeconds"))
            out["sleep_awake_secs"] = _num(dto.get("awakeSleepSeconds"))
            out["respiration_avg"] = _num(dto.get("averageRespirationValue"))
            out["spo2_avg"] = _num(dto.get("averageSpO2Value"))
            score = ((dto.get("sleepScores") or {}).get("overall") or {}).get("value")
            if _num(score) is not None:
                out["sleep_score"] = score
    except Exception as e:
        print(f"  {day}: sleep failed: {e}")

    try:
        rhr = g.get_rhr_day(day) or {}
        metrics = ((rhr.get("allMetrics") or {}).get("metricsMap") or {})
        series = metrics.get("WELLNESS_RESTING_HEART_RATE") or []
        if series:
            out["resting_hr"] = _num(series[0].get("value"))
    except Exception as e:
        print(f"  {day}: resting_hr failed: {e}")

    try:
        stress = g.get_stress_data(day) or {}
        out["stress_avg"] = _num(stress.get("avgStressLevel"))
    except Exception as e:
        print(f"  {day}: stress failed: {e}")

    return {k: v for k, v in out.items() if v is not None}, raw


def write_day(cur, day: str, values: dict, raw: dict) -> bool:
    if not values:
        return False
    cols = list(values)
    placeholders = ", ".join(["%s"] * len(cols))
    updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols)
    cur.execute(
        f"""
        INSERT INTO daily_wellness (date, {", ".join(cols)}, source, synced_at)
        VALUES (%s, {placeholders}, 'garmin', NOW())
        ON CONFLICT (date) DO UPDATE SET {updates}, source = 'garmin', synced_at = NOW()
        """,
        [day] + [values[c] for c in cols],
    )
    if raw:
        cur.execute(
            """
            INSERT INTO daily_wellness_raw (date, payload, synced_at)
            VALUES (%s, %s::jsonb, NOW())
            ON CONFLICT (date) DO UPDATE SET payload = EXCLUDED.payload, synced_at = NOW()
            """,
            (day, json.dumps(raw, default=str)),
        )
    return True


def main() -> int:
    days = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DAYS
    try:
        with gc.garmin_session() as (g, conn, cur):
            ensure_schema(cur)
            conn.commit()

            written = 0
            for i in range(days):
                day = (date.today() - timedelta(days=i)).isoformat()
                values, raw = fetch_day(g, day)
                if write_day(cur, day, values, raw):
                    written += 1
                    print(f"  {day}: {len(values)} metrics")
                else:
                    print(f"  {day}: no data")
                conn.commit()

            print(f"Done. {written}/{days} days written from Garmin.")
    except gc.ReauthRequired as e:
        gc.bail_on_reauth(e)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
