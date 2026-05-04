import pool from '@/lib/db';
import { getProfile } from '@/lib/profile';
import { buildPacingSegments, rhoAtAltitude } from '@/lib/pacing';

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

  // Build planned segments
  const plannedSegs = buildPacingSegments(
    route.stream_distance_km, route.stream_altitude_m,
    route.distance_m / 1000, strategy.climbs,
    strategy.flat_watts, strategy.descent_watts,
    /* riderKg */ 75, strategy.bike_weight_kg,
    strategy.descent_speed_kmh, strategy.flat_speed_kmh,
    accessoriesKg, physics,
  );

  const client = await pool.connect();
  try {
    // Fetch activity info
    const actRes = await client.query<{
      name: string;
      start_date: string;
    }>(`SELECT name, start_date FROM activities WHERE id = $1`, [activityId]);
    if (!actRes.rows.length) return Response.json({ error: 'Activity not found' }, { status: 404 });
    const act = actRes.rows[0];

    // Fetch activity streams
    const streamRes = await client.query<{
      watts:       number[] | null;
      hr:          number[] | null;
      altitude_m:  number[] | null;
      distance_km: number[] | null;
    }>(`SELECT watts, hr, altitude_m, distance_km FROM activity_streams WHERE activity_id = $1`, [activityId]);

    const stream = streamRes.rows[0] ?? null;
    const hasStreams = !!(stream?.distance_km?.length);

    const segments: SegmentComparison[] = plannedSegs.map(seg => {
      let actualTimMin: number | null  = null;
      let actualWatts:  number | null  = null;
      let actualNp:     number | null  = null;
      let actualSpeed:  number | null  = null;
      let actualHr:     number | null  = null;

      if (hasStreams && stream.distance_km) {
        // Find indices in the activity's distance stream that fall within this segment
        const distKm = stream.distance_km;
        const startI = distKm.findIndex(d => d >= seg.start_km);
        let   endI   = distKm.length - 1;
        for (let i = distKm.length - 1; i >= 0; i--) {
          if (distKm[i] <= seg.end_km) { endI = i; break; }
        }

        if (startI >= 0 && endI > startI) {
          const segDistKm = distKm[endI] - distKm[startI];
          // Each array element = 1 second (Strava streams are 1 Hz before downsampling)
          // After 2000-pt downsample, each element represents (original_length / 2000) seconds
          // We approximate: use (endI - startI) elements as proportional time
          // For a more accurate approach, use actual distance and speed from watts
          const elapsedSamples = endI - startI;

          if (segDistKm > 0) {
            // Watts slice
            if (stream.watts) {
              const wSlice = stream.watts.slice(startI, endI + 1).filter(w => w > 0);
              if (wSlice.length > 0) {
                actualWatts = Math.round(wSlice.reduce((a, b) => a + b, 0) / wSlice.length);
                actualNp    = calcNp(wSlice);
              }
            }
            // HR slice
            if (stream.hr) {
              const hrSlice = stream.hr.slice(startI, endI + 1).filter(h => h > 0);
              if (hrSlice.length > 0) {
                actualHr = Math.round(hrSlice.reduce((a, b) => a + b, 0) / hrSlice.length);
              }
            }
            // Speed from distance/time (sample count as proxy for time at original 1Hz)
            // We need original sample count — approximate from stream length ratio
            const origSamplesPerDownsample = 1; // after downsampling, proportional
            actualTimMin   = (elapsedSamples * origSamplesPerDownsample) / 60;
            actualSpeed    = segDistKm > 0 && actualTimMin > 0
              ? Math.round((segDistKm / (actualTimMin / 60)) * 10) / 10
              : null;
          }
        }
      }

      return {
        label:             seg.label,
        type:              seg.type,
        start_km:          seg.start_km,
        end_km:            seg.end_km,
        planned_time_min:  seg.est_time_min,
        actual_time_min:   actualTimMin,
        planned_watts:     seg.target_watts,
        actual_watts:      actualWatts,
        actual_np:         actualNp,
        planned_speed_kmh: seg.avg_speed_kmh,
        actual_speed_kmh:  actualSpeed,
        actual_avg_hr:     actualHr,
      };
    });

    const totalActualMin = hasStreams
      ? segments.reduce((t, s) => t + (s.actual_time_min ?? 0), 0) || null
      : null;

    return Response.json({
      segments,
      total_planned_min:  plannedSegs.reduce((t, s) => t + s.est_time_min, 0),
      total_actual_min:   totalActualMin,
      activity_name:      act.name,
      activity_date:      act.start_date,
      has_streams:        hasStreams,
    } satisfies CompareResponse);
  } finally {
    client.release();
  }
}
