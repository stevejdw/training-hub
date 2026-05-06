import pool from '@/lib/db';

import { getProfile, effectiveFtp } from '@/lib/profile';
import {
  buildPacingSegments,
  matchPacingSegmentToActivityStream,
  findNearestRouteKmWithDist,
  rhoAtAltitude,
} from '@/lib/pacing';

const DEFAULT_CDA = 0.35;

export const runtime = 'nodejs';

export interface SegmentComparison {
  label:              string;
  type:               'flat' | 'climb' | 'descent';
  start_km:           number;
  end_km:             number;
  planned_time_min:   number;
  actual_time_min:    number | null;
  planned_watts:      number;
  actual_watts:       number | null;
  actual_np:          number | null;
  planned_speed_kmh:  number;
  actual_speed_kmh:   number | null;
  actual_avg_hr:      number | null;
}

export interface CompareResponse {
  segments:            SegmentComparison[];
  total_planned_min:   number;
  total_actual_min:    number | null;
  activity_name:       string;
  activity_date:       string;
  has_streams:         boolean;
}

function calcNp(watts: number[]): number | null {
  if (watts.length < 30) return null;
  const sum4 = watts.reduce((s, w) => s + Math.pow(w, 4), 0);
  return Math.round(Math.pow(sum4 / watts.length, 0.25));
}

function pgLatLngToPairs(raw: unknown): [number, number][] | undefined {
  if (raw == null || !Array.isArray(raw)) return undefined;
  const out: [number, number][] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const lat = Number(item[0]);
    const lng = Number(item[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) out.push([lat, lng]);
  }
  return out.length ? out : undefined;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; activityId: string }> },
) {
  const { id: eventId, activityId } = await params;
  const url = new URL(req.url);

  const profile = await getProfile();
  const event   = profile.events.find(e => (e.id ?? '') === eventId);
  if (!event || !event.route) {
    return Response.json({ error: 'Event or route not found' }, { status: 404 });
  }

  const route    = event.route;
  const dbStrategy = event.pacing_strategy;

  // Allow caller to override the saved pacing strategy via query params.
  // This ensures the comparison always reflects what the user sees on screen.
  const flatWatts = url.searchParams.has('flat_watts')
    ? Number(url.searchParams.get('flat_watts'))
    : (dbStrategy?.flat_watts ?? 260);
  const descentWatts = url.searchParams.has('descent_watts')
    ? Number(url.searchParams.get('descent_watts'))
    : (dbStrategy?.descent_watts ?? 120);
  const descentSpeedKmh = url.searchParams.has('descent_speed_kmh')
    ? Number(url.searchParams.get('descent_speed_kmh'))
    : (dbStrategy?.descent_speed_kmh ?? undefined);
  const flatSpeedKmh = url.searchParams.has('flat_speed_kmh')
    ? Number(url.searchParams.get('flat_speed_kmh'))
    : (dbStrategy?.flat_speed_kmh ?? undefined);
  const accessoriesKg = url.searchParams.has('accessories_kg')
    ? Number(url.searchParams.get('accessories_kg'))
    : (dbStrategy?.accessories_kg ?? 2.0);
  const cda = url.searchParams.has('cda')
    ? Number(url.searchParams.get('cda'))
    : (dbStrategy?.cda ?? DEFAULT_CDA);
  const bikeKg = dbStrategy?.bike_weight_kg ?? 8;

  // Build climbs from query params (climb_0_watts, climb_1_watts, …) or fall back to DB strategy climbs
  let climbs = dbStrategy?.climbs ?? [];
  if (url.searchParams.has('climb_0_watts')) {
    climbs = climbs.map((c, i) => {
      const kw = url.searchParams.get(`climb_${i}_watts`);
      return kw != null ? { ...c, target_watts: Number(kw) } : c;
    });
  }

  const rho = route.stream_altitude_m.length > 0
    ? rhoAtAltitude(route.stream_altitude_m.reduce((a, b) => a + b, 0) / route.stream_altitude_m.length)
    : undefined;
  const physics = { cda, rho };
  const riderKg = profile.weight_kg ?? 75;
  const ftp = effectiveFtp(profile);

  const sortedClimbs = [...climbs].sort((a, b) => a.start_km - b.start_km);

  const plannedSegsBase = buildPacingSegments(
    route.stream_distance_km, route.stream_altitude_m,
    route.distance_m / 1000, sortedClimbs,
    flatWatts, descentWatts,
    riderKg, bikeKg,
    descentSpeedKmh, flatSpeedKmh,
    accessoriesKg, physics,
    route.stream_latlng,
    ftp,
  );

  const client = await pool.connect();
  try {
    const actRes = await client.query<{
      name: string;
      start_date: string;
      moving_time: number;
    }>(`SELECT name, start_date, moving_time FROM activities WHERE id = $1`, [activityId]);
    if (!actRes.rows.length) return Response.json({ error: 'Activity not found' }, { status: 404 });
    const act = actRes.rows[0];

    const streamRes = await client.query<{
      watts:       number[] | null;
      hr:          number[] | null;
      altitude_m:  number[] | null;
      distance_km: number[] | null;
      latlng:      unknown | null;
      time_s:      number[] | null;
    }>(`SELECT watts, hr, altitude_m, distance_km, latlng, time_s FROM activity_streams WHERE activity_id = $1`, [activityId]);

    const stream = streamRes.rows[0] ?? null;
    const hasStreams = !!(stream?.distance_km?.length);
    const actLatlng = stream?.latlng != null ? pgLatLngToPairs(stream.latlng) : undefined;

    // Total moving time and activity distance for fallback time estimation
    const actMovingTimeSec = act.moving_time;
    const actStreamPts = hasStreams && stream?.distance_km ? stream.distance_km.length : 0;

    // ── Starred segments on this route ──────────────────────────────
    interface StarredSegOnRoute {
      id:        number;
      name:      string;
      start_km:  number;
      end_km:    number;
      distance_m: number;
    }
    const starredOnRoute: StarredSegOnRoute[] = [];
    if (route.stream_latlng && route.stream_latlng.length >= 10) {
      const ssRes = await client.query<{
        id: number; name: string;
        start_lat: number; start_lng: number;
        end_lat: number; end_lng: number;
        distance: number;
      }>(`SELECT id, name, start_lat, start_lng, end_lat, end_lng, distance
          FROM starred_segments WHERE start_lat IS NOT NULL AND end_lat IS NOT NULL`);
      for (const ss of ssRes.rows) {
        const startInfo = findNearestRouteKmWithDist(route.stream_latlng, route.stream_distance_km, [ss.start_lat, ss.start_lng]);
        const endInfo   = findNearestRouteKmWithDist(route.stream_latlng, route.stream_distance_km, [ss.end_lat, ss.end_lng]);
        if (startInfo && endInfo && endInfo.km > startInfo.km) {
          starredOnRoute.push({ id: ss.id, name: ss.name, start_km: startInfo.km, end_km: endInfo.km, distance_m: ss.distance });
        }
      }
    }

    // Fetch segment efforts for this activity
    const effortRes = await client.query<{
      segment_id: number;
      elapsed_time: number;
      moving_time: number;
      average_watts: number | null;
      average_heartrate: number | null;
      max_heartrate: number | null;
      pr_rank: number | null;
      kom_rank: number | null;
    }>(`SELECT segment_id, elapsed_time, moving_time, average_watts, average_heartrate, max_heartrate, pr_rank, kom_rank
        FROM segment_efforts WHERE activity_id = $1`, [activityId]);
    const effortsBySegment: Map<number, typeof effortRes.rows[0]> = new Map();
    for (const e of effortRes.rows) {
      effortsBySegment.set(e.segment_id, e);
    }

    const segments: SegmentComparison[] = plannedSegsBase.map((baseSeg) => {
      // Check if a starred segment falls within this pacing segment
      let starredMatch: StarredSegOnRoute | undefined;
      for (const ss of starredOnRoute) {
        if (ss.start_km >= baseSeg.start_km - 0.5 && ss.end_km <= baseSeg.end_km + 0.5) {
          if (!starredMatch || (ss.end_km - ss.start_km) > (starredMatch.end_km - starredMatch.start_km)) {
            starredMatch = ss;
          }
        }
      }
      let actualNp:      number | null = null;
      let actualHr:      number | null = null;
      let actualTimeMin: number | null = null;
      let actualWatts:   number | null = null;
      let label = baseSeg.label;

      // Does the starred segment closely match the pacing segment's boundaries?
      // "Close" = the starred segment's GPS-mapped start/end are within
      // 15% of the pacing segment's length or 500m absolute, whichever is larger.
      let useStarredMetrics = false;
      if (starredMatch) {
        const segLen = baseSeg.end_km - baseSeg.start_km;
        const matchOverlap = Math.min(segLen, starredMatch.end_km - starredMatch.start_km);
        if (matchOverlap > 0 && starredMatch.end_km - starredMatch.start_km >= segLen * 0.85) {
          useStarredMetrics = true;
        }
        label = `${baseSeg.label} (★ ${starredMatch.name})`;
      }

      // If a starred segment closely matches the pacing segment boundary and has
      // Strava effort data, use the effort data as ground truth (GPS-precise).
      if (useStarredMetrics && starredMatch && effortsBySegment.has(starredMatch.id)) {
        const effort = effortsBySegment.get(starredMatch.id)!;
        actualTimeMin = effort.moving_time > 0 ? effort.moving_time / 60 : null;
        actualWatts  = effort.average_watts != null ? Math.round(effort.average_watts) : null;
        actualHr     = effort.average_heartrate != null ? Math.round(effort.average_heartrate) : null;
      }

      // Stream-based matching (for time when starred effort doesn't exactly match, and for
      // segments where no starred segment applies)
      if (actualTimeMin == null && hasStreams && stream?.distance_km) {
        const win = matchPacingSegmentToActivityStream(
          baseSeg,
          route.stream_distance_km,
          route.stream_latlng,
          stream.distance_km,
          actLatlng,
        );
        if (win && win.startIdx < win.endIdx) {
          if (stream.time_s && win.endIdx < stream.time_s.length) {
            const elapsedSec = stream.time_s[win.endIdx] - stream.time_s[win.startIdx];
            if (elapsedSec > 0) actualTimeMin = elapsedSec / 60;
          }
          if (actualTimeMin == null && actMovingTimeSec > 0 && actStreamPts > 1) {
            const ptsInWindow = win.endIdx - win.startIdx + 1;
            const timePerPt = actMovingTimeSec / actStreamPts;
            actualTimeMin = (ptsInWindow * timePerPt) / 60;
          }
          if (stream.watts) {
            const wSlice = stream.watts.slice(win.startIdx, win.endIdx + 1).filter(w => w != null && w > 0) as number[];
            if (wSlice.length > 0) {
              actualNp    = calcNp(wSlice);
              actualWatts = actualWatts ?? Math.round(wSlice.reduce((a, b) => a + b, 0) / wSlice.length);
            }
          }
          if (stream.hr) {
            const hrSlice = stream.hr.slice(win.startIdx, win.endIdx + 1).filter(h => h != null && h > 0) as number[];
            if (hrSlice.length > 0) {
              actualHr = actualHr ?? Math.round(hrSlice.reduce((a, b) => a + b, 0) / hrSlice.length);
            }
          }
        }
      }

      const actualSpeedKmh = actualTimeMin != null && actualTimeMin > 0 && baseSeg.distance_km > 0
        ? Math.round((baseSeg.distance_km / (actualTimeMin / 60)) * 10) / 10
        : null;

      return {
        label:             label,
        type:              baseSeg.type,
        start_km:          baseSeg.start_km,
        end_km:            baseSeg.end_km,
        planned_time_min:  baseSeg.est_time_min,
        actual_time_min:   actualTimeMin,
        planned_watts:     baseSeg.target_watts,
        actual_watts:      actualWatts,
        actual_np:         actualNp,
        planned_speed_kmh: baseSeg.avg_speed_kmh,
        actual_speed_kmh:  actualSpeedKmh,
        actual_avg_hr:     actualHr,
      };
    });

    const totalActualMin = hasStreams
      ? segments.reduce((t, s) => t + (s.actual_time_min ?? 0), 0) || null
      : null;

    return Response.json({
      segments,
      total_planned_min:  plannedSegsBase.reduce((t, s) => t + s.est_time_min, 0),
      total_actual_min:   totalActualMin,
      activity_name:      act.name,
      activity_date:      act.start_date,
      has_streams:        hasStreams,
    } satisfies CompareResponse);
  } finally {
    client.release();
  }
}
