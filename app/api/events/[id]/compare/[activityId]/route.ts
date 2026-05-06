import pool from '@/lib/db';
import { getProfile, effectiveFtp } from '@/lib/profile';
import {
  buildPacingSegments,
  matchPacingSegmentToActivityStream,
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

    const segments: SegmentComparison[] = plannedSegsBase.map((baseSeg) => {
      let actualNp:      number | null = null;
      let actualHr:      number | null = null;
      let actualTimeMin: number | null = null;
      let actualWatts:   number | null = null;

      if (hasStreams && stream?.distance_km) {
        const win = matchPacingSegmentToActivityStream(
          baseSeg,
          route.stream_distance_km,
          route.stream_latlng,
          stream.distance_km,
          actLatlng,
        );
        if (win && win.startIdx < win.endIdx) {
          // Accurate time from the time_s stream
          if (stream.time_s && win.endIdx < stream.time_s.length) {
            const elapsedSec = stream.time_s[win.endIdx] - stream.time_s[win.startIdx];
            if (elapsedSec > 0) actualTimeMin = elapsedSec / 60;
          }
          // Fallback: estimate time from number of stream points within the matched
          // window × average time per point.  This is more accurate than distance
          // ratio because stream points are roughly evenly spaced in time.
          if (actualTimeMin == null && actMovingTimeSec > 0 && actStreamPts > 1) {
            const ptsInWindow = win.endIdx - win.startIdx + 1;
            const timePerPt = actMovingTimeSec / actStreamPts;
            actualTimeMin = (ptsInWindow * timePerPt) / 60;
          }
          if (stream.watts) {
            const wSlice = stream.watts.slice(win.startIdx, win.endIdx + 1).filter(w => w != null && w > 0) as number[];
            if (wSlice.length > 0) {
              actualNp    = calcNp(wSlice);
              actualWatts = Math.round(wSlice.reduce((a, b) => a + b, 0) / wSlice.length);
            }
          }
          if (stream.hr) {
            const hrSlice = stream.hr.slice(win.startIdx, win.endIdx + 1).filter(h => h != null && h > 0) as number[];
            if (hrSlice.length > 0) {
              actualHr = Math.round(hrSlice.reduce((a, b) => a + b, 0) / hrSlice.length);
            }
          }
        }
      }

      const actualSpeedKmh = actualTimeMin != null && actualTimeMin > 0 && baseSeg.distance_km > 0
        ? Math.round((baseSeg.distance_km / (actualTimeMin / 60)) * 10) / 10
        : null;

      return {
        label:             baseSeg.label,
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
