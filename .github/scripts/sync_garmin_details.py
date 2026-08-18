#!/usr/bin/env python3
"""Fill streams, laps and the route polyline for Garmin-sourced activities.

sync_garmin_activities writes summary fields only. Everything the app builds
from per-second data — the power/HR charts, time-in-zone, the durability curve,
aerobic efficiency, the activity map — reads `activity_streams`, `laps` and
`activities.summary_polyline`, all of which only Strava used to populate. A
Garmin-only ride therefore arrived with correct totals and an empty detail view.

Garmin's activity-details endpoint carries the same series (power, HR, cadence,
elevation, distance, lat/lng, temperature) plus the GPS polyline, and
get_activity_splits carries the laps, so nothing needs the FIT file.

Only touches rows that are missing the data, so it is safe to re-run.

Usage:  python sync_garmin_details.py [limit]   (default 25)
"""

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import garmin_common as gc  # noqa: E402

PROVIDER = "garmin-details"
DEFAULT_LIMIT = 25
STREAM_MAX_POINTS = 5000
# Near-1Hz even for a long ride; Garmin downsamples server-side to this cap.
MAX_CHART_POINTS = 20000
# Laps need their own key space: `laps.id` holds Strava's lap id, and Garmin
# has no equivalent. 2e15 + activity*100 + index stays clear of Strava's ~2e10
# ids and inside Number.MAX_SAFE_INTEGER.
LAP_ID_OFFSET = 2_000_000_000_000_000


def encode_polyline(points) -> str:
    """Google encoded polyline. Written out rather than pulled in as a
    dependency — it is 20 lines and the GitHub jobs install nothing else."""
    out, prev_lat, prev_lng = [], 0, 0
    for lat, lng in points:
        lat_e5, lng_e5 = int(round(lat * 1e5)), int(round(lng * 1e5))
        for delta in (lat_e5 - prev_lat, lng_e5 - prev_lng):
            v = ~(delta << 1) if delta < 0 else (delta << 1)
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        prev_lat, prev_lng = lat_e5, lng_e5
    return "".join(out)


def downsample(arr, max_pts=STREAM_MAX_POINTS):
    if not arr or len(arr) <= max_pts:
        return arr
    step = len(arr) / max_pts
    return [arr[min(len(arr) - 1, round(i * step))] for i in range(max_pts)]


def series(details):
    """Pull the metric series we store out of Garmin's index-addressed rows."""
    idx = {
        m.get("key"): m.get("metricsIndex")
        for m in (details.get("metricDescriptors") or [])
    }
    rows = details.get("activityDetailMetrics") or []

    def col(key):
        i = idx.get(key)
        if i is None:
            return None
        vals = []
        for r in rows:
            m = r.get("metrics") or []
            vals.append(m[i] if i < len(m) else None)
        return vals if any(v is not None for v in vals) else None

    return {
        "watts":       col("directPower"),
        "hr":          col("directHeartRate"),
        "cadence":     col("directBikeCadence"),
        "altitude":    col("directElevation"),
        "distance_m":  col("sumDistance"),
        "elapsed_s":   col("sumElapsedDuration") or col("sumDuration"),
        "lat":         col("directLatitude"),
        "lng":         col("directLongitude"),
        "temperature": col("directAirTemperature"),
    }


def as_int_array(vals):
    if not vals:
        return None
    return [int(round(v)) if isinstance(v, (int, float)) else None for v in vals]


def write_streams(cur, activity_id, s) -> bool:
    watts = as_int_array(s["watts"])
    hr = as_int_array(s["hr"])
    if not watts and not hr:
        return False

    alt = [round(v, 1) if isinstance(v, (int, float)) else None
           for v in downsample(s["altitude"] or [])] or None
    dist = [round(v / 1000, 2) if isinstance(v, (int, float)) else None
            for v in downsample(s["distance_m"] or [])] or None
    tsec = as_int_array(downsample(s["elapsed_s"] or [])) or None
    latlng = None
    if s["lat"] and s["lng"]:
        pairs = [[a, b] for a, b in zip(s["lat"], s["lng"])
                 if isinstance(a, (int, float)) and isinstance(b, (int, float))]
        latlng = downsample(pairs) or None
    cadence = as_int_array(s["cadence"])
    temp = as_int_array(s["temperature"])

    cur.execute(
        """
        ALTER TABLE activity_streams ADD COLUMN IF NOT EXISTS cadence       INT[];
        ALTER TABLE activity_streams ADD COLUMN IF NOT EXISTS temperature_c SMALLINT[];
        """
    )
    cur.execute(
        """
        INSERT INTO activity_streams
          (activity_id, watts, hr, altitude_m, distance_km, latlng, time_s, cadence, temperature_c)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (activity_id) DO UPDATE SET
          watts         = COALESCE(EXCLUDED.watts,         activity_streams.watts),
          hr            = COALESCE(EXCLUDED.hr,            activity_streams.hr),
          altitude_m    = COALESCE(EXCLUDED.altitude_m,    activity_streams.altitude_m),
          distance_km   = COALESCE(EXCLUDED.distance_km,   activity_streams.distance_km),
          latlng        = COALESCE(EXCLUDED.latlng,        activity_streams.latlng),
          time_s        = COALESCE(EXCLUDED.time_s,        activity_streams.time_s),
          cadence       = COALESCE(EXCLUDED.cadence,       activity_streams.cadence),
          temperature_c = COALESCE(EXCLUDED.temperature_c, activity_streams.temperature_c)
        """,
        (activity_id, watts, hr, alt, dist, latlng, tsec, cadence, temp),
    )
    return True


def write_laps(cur, activity_id, garmin_id, splits) -> int:
    laps = (splits or {}).get("lapDTOs") or []
    rows = []
    for i, lp in enumerate(laps):
        rows.append((
            LAP_ID_OFFSET + garmin_id * 100 + i,
            activity_id,
            lp.get("intensityType") or f"Lap {i + 1}",
            i + 1,
            int(lp.get("elapsedDuration") or lp.get("duration") or 0) or None,
            int(lp.get("movingDuration") or lp.get("duration") or 0) or None,
            lp.get("distance"),
            lp.get("averagePower"),
            lp.get("normalizedPower"),
            lp.get("averageHR"),
            lp.get("maxHR"),
            lp.get("averageSpeed"),
            lp.get("elevationGain"),
        ))
    if not rows:
        return 0
    cur.executemany(
        """
        INSERT INTO laps (id, activity_id, name, lap_index, elapsed_time, moving_time,
                          distance, average_watts, normalized_power,
                          average_heartrate, max_heartrate, average_speed, total_elevation_gain)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (id) DO NOTHING
        """,
        rows,
    )
    return len(rows)


def main() -> int:
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_LIMIT
    try:
        with gc.garmin_session() as (g, conn, cur):
            if gc.primary_source(cur) != "garmin":
                print("Garmin ingest is off — primary source is Strava. Nothing to do.")
                gc.record_sync_health(cur, PROVIDER, True, detail="skipped: not primary")
                conn.commit()
                return 0

            cur.execute(
                """
                SELECT a.id, a.garmin_id, a.name
                  FROM activities a
                  LEFT JOIN activity_streams s ON s.activity_id = a.id
                 WHERE a.garmin_id IS NOT NULL
                   AND (s.activity_id IS NULL OR a.summary_polyline IS NULL)
                 ORDER BY a.start_date DESC
                 LIMIT %s
                """,
                (limit,),
            )
            todo = cur.fetchall()
            print(f"{len(todo)} activities need details")

            filled = 0
            for internal_id, garmin_id, name in todo:
                try:
                    details = g.get_activity_details(
                        garmin_id, maxchart=MAX_CHART_POINTS, maxpoly=MAX_CHART_POINTS
                    )
                    s = series(details)
                    wrote = write_streams(cur, internal_id, s)

                    poly_pts = [
                        (p["lat"], p["lon"])
                        for p in ((details.get("geoPolylineDTO") or {}).get("polyline") or [])
                        if p.get("lat") is not None and p.get("lon") is not None
                    ]
                    if poly_pts:
                        cur.execute(
                            "UPDATE activities SET summary_polyline = %s WHERE id = %s AND summary_polyline IS NULL",
                            (encode_polyline(downsample(poly_pts)), internal_id),
                        )

                    n_laps = 0
                    try:
                        n_laps = write_laps(cur, internal_id, garmin_id, g.get_activity_splits(garmin_id))
                    except Exception as e:
                        print(f"    laps failed: {e}")

                    conn.commit()
                    filled += 1
                    print(f"  {name}: streams={'y' if wrote else 'n'} "
                          f"pts={len(s['watts'] or s['hr'] or [])} laps={n_laps} "
                          f"poly={'y' if poly_pts else 'n'}")
                except Exception as e:
                    conn.rollback()
                    print(f"  FAILED {name} ({garmin_id}): {e}")

            gc.record_sync_health(cur, PROVIDER, True, detail=f"{filled}/{len(todo)} filled")
            conn.commit()
            print(f"Done. {filled}/{len(todo)} activities filled.")
    except gc.ReauthRequired as e:
        gc.bail_on_reauth(e)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
