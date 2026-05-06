import pool from '@/lib/db';
import { getProfile, effectiveFtp } from '@/lib/profile';
import {
  applyReferenceActivityToPacingSegments,
  buildPacingSegments,
  matchPacingSegmentToActivityStream,
  rhoAtAltitude,
} from '@/lib/pacing';

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
  _req: Request,
  { params }: { params: Promise<{ id: string; activityId: string }> },
) {
  const { id: eventId, activityId } = await params;

  const profile = await getProfile();
  const event   = profile.events.find(e => (e.id ?? '') === eventId);
  if (!event || !event.route || !event.pacing_strategy) {
    return Response.json({ error: 'Event or pacing strategy not found' }, { status: 404 });
  }

  const route    = event.route;
  const strategy = event.pacing_strategy;

  const rho = route.stream_altitude_m.length > 0
    ? rhoAtAltitude(route.stream_altitude_m.reduce((a, b) => a + b, 0) / route.stream_altitude_m.length)
    : undefined;
  const physics = { cda: strategy.cda, rho };
  const accessoriesKg = strategy.accessories_kg ?? 2.0;
  const riderKg = profile.weight_kg ?? 75;
  const ftp = effectiveFtp(profile);

  const sortedClimbs = [...strategy.climbs].sort((a, b) => a.start_km - b.start_km);

  const plannedSegsBase = buildPacingSegments(
    route.stream_distance_km, route.stream_altitude_m,
    route.distance_m / 1000, sortedClimbs,
    strategy.flat_watts, strategy.descent_watts,
    riderKg, strategy.bike_weight_kg,
    strategy.descent_speed_kmh, strategy.flat_speed_kmh,
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

    let plannedSegs = plannedSegsBase;
    if (hasStreams && stream.distance_km && act.moving_time > 0) {
      plannedSegs = applyReferenceActivityToPacingSegments(plannedSegsBase, {
        streamDistKm:     route.stream_distance_km,
        streamAltM:       route.stream_altitude_m,
        streamLatLng:     route.stream_latlng,
        reference: {
          distance_km:     stream.distance_km,
          watts:           stream.watts,
          latlng:          actLatlng,
          time_s:          stream.time_s,
          moving_time_sec: act.moving_time,
        },
        flatWatts:        strategy.flat_watts,
        descentWatts:     strategy.descent_watts,
        descentSpeedKmh:  strategy.descent_speed_kmh,
        flatSpeedKmh:     strategy.flat_speed_kmh,
        riderKg,
        bikeKg:           strategy.bike_weight_kg,
        accessoriesKg,
        physics,
        sortedClimbs,
      });
    }

    const segments: SegmentComparison[] = plannedSegsBase.map((baseSeg, i) => {
      const refSeg = plannedSegs[i];
      let actualNp:      number | null = null;
      let actualHr:      number | null = null;
      let actualTimeMin: number | null = refSeg?.prev_time_min ?? null;
      let actualWatts:   number | null = refSeg?.prev_avg_watts ?? null;

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
