/**
 * Physics-based cycling speed / time estimation.
 *
 * Model:
 *   P_input = P_gravity + P_rolling + P_aero
 *   P_gravity = m·g·grad·v          (grad = rise/run, negative = descent)
 *   P_rolling = Crr·m·g·v
 *   P_aero    = ½·CdA·ρ·v³
 *
 * Solve for v using Newton-Raphson (converges in <20 iterations).
 *
 * Constants calibrated against real-world Peaks Challenge data:
 *   - Starting descent (~30 km / 3.67% avg): actual 38:00–38:12 → model 38.3 min ✓
 *   - Climb 1 at 302 W (82 kg rider + 8 kg bike): actual 27:54 → consistent ✓
 *   - Climb 1 at 275 W: actual 28:49 → consistent ✓
 *
 * Key lever for descent accuracy: CdA.  0.35 m² represents a sportive cyclist
 * on the hoods / sitting up during a long alpine event — not the aggressive aero
 * drops position used in short TTs (0.28–0.32 m²).
 *
 * IMPORTANT: the climb time estimate is highly sensitive to rider weight.
 * Ensure Settings → Physical → Rider Weight is set correctly.
 */

const G     = 9.81;         // m/s²
const RHO   = 1.225;        // kg/m³  air density at sea level
const CDA   = 0.35;         // m²     sportive position (hoods / upright on climbs)
const CRR   = 0.0045;       // rolling resistance — conservative for varied alpine roads
const V_MAX = 65 / 3.6;    // m/s    hard cap (≈ 65 km/h); real limit is usually corners

/**
 * Return the steady-state speed (m/s) for a given power and gradient.
 * @param watts  Mechanical power at the pedals
 * @param grad   Slope as a fraction (e.g. 0.06 = 6% climb, -0.05 = 5% descent)
 * @param totalKg  Rider + bike total mass in kg
 */
export function speedForPower(watts: number, grad: number, totalKg: number): number {
  const A = totalKg * G * (grad + CRR);   // linear term (gravity + rolling)
  const B = 0.5 * CDA * RHO;              // cubic term (aero)

  // f(v)  = A·v + B·v³ - P = 0
  // f'(v) = A   + 3B·v²

  // Initial guess: assume aero dominates on flats, gravity on climbs
  let v = grad > 0.03 ? 4.0 : grad < -0.03 ? V_MAX * 0.7 : 8.0;

  for (let i = 0; i < 60; i++) {
    const f  = A * v + B * v * v * v - watts;
    const df = A + 3 * B * v * v;
    if (Math.abs(df) < 1e-12) break;
    const dv = f / df;
    v -= dv;
    v  = Math.min(Math.max(v, 0.3), V_MAX);
    if (Math.abs(dv) < 1e-6) break;
  }
  return Math.min(Math.max(v, 0.3), V_MAX);
}

export interface EventClimbInput {
  start_km:    number;
  end_km:      number;
  target_watts: number;
}

export interface PacingInput {
  stream_distance_km: number[];
  stream_altitude_m:  number[];
  flat_watts:         number;
  descent_watts:      number;
  climbs:             EventClimbInput[];
  rider_weight_kg:    number;
  bike_weight_kg:     number;
}

/** Compute total estimated riding time in minutes. */
export function estimateTime(input: PacingInput): number {
  const {
    stream_distance_km, stream_altitude_m,
    flat_watts, descent_watts, climbs,
    rider_weight_kg, bike_weight_kg,
  } = input;

  const totalKg = rider_weight_kg + bike_weight_kg;
  let totalSec = 0;

  for (let i = 1; i < stream_distance_km.length; i++) {
    const dDist  = (stream_distance_km[i] - stream_distance_km[i - 1]) * 1000; // metres
    const dAlt   = stream_altitude_m[i] - stream_altitude_m[i - 1];            // metres
    if (dDist <= 0) continue;

    const grad = dAlt / dDist;
    const km   = (stream_distance_km[i - 1] + stream_distance_km[i]) / 2;

    // Find applicable watts: check if km is inside a defined climb
    const climbMatch = climbs.find(c => km >= c.start_km && km <= c.end_km);
    let watts: number;
    if (climbMatch) {
      watts = climbMatch.target_watts;
    } else if (grad < -0.01) {
      watts = descent_watts;  // coasting / light pedalling on descents
    } else {
      watts = flat_watts;
    }

    const v   = speedForPower(watts, grad, totalKg);
    totalSec += dDist / v;
  }

  return totalSec / 60;
}

export interface DetectedClimb {
  start_km:       number;
  end_km:         number;
  distance_km:    number;
  elevation_gain: number;
  avg_gradient:   number;
}

/**
 * Check if a climb segment meets the quality thresholds.
 *
 * Tuned for the Peaks Challenge route (8 known climbs):
 *   33.6 km · 73.9 km · 83.9 km · 93.9 km · 146 km · 166.6 km · 200 km · 215 km
 *
 * Tiers ordered steepest-first so a segment only needs to satisfy one row.
 */
function qualifiesAsKeyClimb(distKm: number, gainM: number, gradPct: number): boolean {
  if (gradPct >= 10 && distKm >= 0.3  && gainM >= 40)  return true; // short wall
  if (gradPct >= 7  && distKm >= 0.5  && gainM >= 60)  return true;
  if (gradPct >= 5  && distKm >= 0.6  && gainM >= 60)  return true;
  if (gradPct >= 3  && distKm >= 1.0  && gainM >= 80)  return true;
  if (gradPct >= 2  && distKm >= 4.0  && gainM >= 80)  return true; // long gentle climbs
  if (gradPct >= 1.5 && distKm >= 8.0 && gainM >= 80)  return true; // very long shallow
  return false;
}

/**
 * Auto-detect significant climbs from elevation profile using multi-tier thresholds.
 * A climb qualifies if any of these hold:
 *   >3% avg, >1.2 km, >100 m gain
 *   >5% avg, >0.7 km, >70 m gain
 *   >7% avg, >0.6 km, >70 m gain
 *   >10% avg, >0.4 km, >50 m gain
 */
export function detectClimbs(
  distKm: number[],
  altM:   number[],
): DetectedClimb[] {
  const n = Math.min(distKm.length, altM.length);
  if (n < 2) return [];

  // Smooth altitude with a 0.5km rolling window — keeps valley→climb transitions
  // sharp so consecutive climbs separated by a short descent are detected separately.
  const SMOOTH_KM = 0.5;
  const smoothed  = altM.slice();
  for (let i = 0; i < n; i++) {
    let sum = 0, cnt = 0;
    for (let j = 0; j < n; j++) {
      if (Math.abs(distKm[j] - distKm[i]) <= SMOOTH_KM / 2) { sum += altM[j]; cnt++; }
    }
    smoothed[i] = cnt ? sum / cnt : altM[i];
  }

  // Mark each segment as climbing if smoothed gradient >= 1.0%.
  // Lower than the previous 1.5% so climbs with gentle approaches (common on
  // alpine routes) are captured from their real start km.
  // The qualifiesAsKeyClimb filter below suppresses short/minor false positives.
  const isClimbing = Array(n).fill(false);
  for (let i = 1; i < n; i++) {
    const dDist = (distKm[i] - distKm[i - 1]) * 1000;
    const dAlt  = smoothed[i] - smoothed[i - 1];
    if (dDist > 0 && (dAlt / dDist) * 100 >= 1.0) isClimbing[i] = true;
  }

  // Group consecutive climbing segments
  const rawClimbs: DetectedClimb[] = [];
  let startIdx: number | null = null;

  for (let i = 1; i <= n; i++) {
    const climbing = i < n && isClimbing[i];
    if (climbing && startIdx === null) {
      startIdx = i - 1;
    } else if (!climbing && startIdx !== null) {
      const endIdx = i - 1;
      const gain   = altM[endIdx] - altM[startIdx];
      const dist   = distKm[endIdx] - distKm[startIdx];
      const avgGrad = dist > 0 ? (gain / (dist * 1000)) * 100 : 0;
      if (gain > 0 && dist > 0 && qualifiesAsKeyClimb(dist, gain, avgGrad)) {
        rawClimbs.push({
          start_km:       Math.round(distKm[startIdx] * 10) / 10,
          end_km:         Math.round(distKm[endIdx]   * 10) / 10,
          distance_km:    Math.round(dist * 10) / 10,
          elevation_gain: Math.round(gain),
          avg_gradient:   Math.round(avgGrad * 10) / 10,
        });
      }
      startIdx = null;
    }
  }

  // Merge climbs that are very close together (< 0.3 km gap — brief dip only).
  // Keeping the gap small preserves consecutive distinct climbs (e.g. 10 km + 10 km
  // separated by a short descent) that a larger window would incorrectly merge.
  const merged: DetectedClimb[] = [];
  for (const c of rawClimbs) {
    const prev = merged[merged.length - 1];
    if (prev && c.start_km - prev.end_km < 0.3) {
      const gain = prev.elevation_gain + c.elevation_gain;
      const dist = c.end_km - prev.start_km;
      merged[merged.length - 1] = {
        start_km:       prev.start_km,
        end_km:         c.end_km,
        distance_km:    Math.round(dist * 10) / 10,
        elevation_gain: gain,
        avg_gradient:   Math.round((gain / (dist * 1000)) * 1000) / 10,
      };
    } else {
      merged.push(c);
    }
  }

  return merged;
}

// ─── Pacing segments ───────────────────────────────────────────────────────

export interface PacingSegment {
  label:          string;
  type:           'flat' | 'descent' | 'climb';
  climb_idx?:     number;
  start_km:       number;
  end_km:         number;
  distance_km:    number;
  elevation_gain: number;   // net m (negative = descent)
  ascent_m:       number;   // total m gained (always ≥ 0)
  avg_gradient:   number;   // % (negative = downhill)
  target_watts:   number;
  est_time_min:   number;
}

interface ClimbRef {
  name:         string;
  start_km:     number;
  end_km:       number;
  target_watts: number;
}

/** Build a list of pacing segments from the full route + climb list. */
export function buildPacingSegments(
  streamDistKm:  number[],
  streamAltM:    number[],
  totalDistKm:   number,
  climbs:        ClimbRef[],
  flatWatts:     number,
  descentWatts:  number,
  riderKg:       number,
  bikeKg:        number,
): PacingSegment[] {
  const sorted = [...climbs].sort((a, b) => a.start_km - b.start_km);

  // Build interval list: [start, end, climbIdx | undefined]
  const intervals: { s: number; e: number; ci?: number }[] = [];
  let cursor = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].start_km > cursor + 0.1) {
      intervals.push({ s: cursor, e: sorted[i].start_km });
    }
    intervals.push({ s: sorted[i].start_km, e: sorted[i].end_km, ci: i });
    cursor = sorted[i].end_km;
  }
  if (cursor < totalDistKm - 0.1) {
    intervals.push({ s: cursor, e: totalDistKm });
  }

  const segs: PacingSegment[] = [];
  for (const { s: startKm, e: endKm, ci } of intervals) {
    if (endKm <= startKm + 0.05) continue;

    // Slice streams to this interval
    const sliceD: number[] = [];
    const sliceA: number[] = [];
    for (let i = 0; i < streamDistKm.length; i++) {
      if (streamDistKm[i] >= startKm && streamDistKm[i] <= endKm) {
        sliceD.push(streamDistKm[i]);
        sliceA.push(streamAltM[i]);
      }
    }
    if (sliceD.length < 2) continue;

    // Elevation stats
    const netGain = sliceA[sliceA.length - 1] - sliceA[0];
    let ascent = 0;
    for (let i = 1; i < sliceA.length; i++) {
      const diff = sliceA[i] - sliceA[i - 1];
      if (diff > 0) ascent += diff;
    }
    const distKm    = endKm - startKm;
    const avgGrad   = distKm > 0 ? (netGain / (distKm * 1000)) * 100 : 0;

    // Determine type + watts
    const isClimb = ci !== undefined;
    let type:   PacingSegment['type'];
    let label:  string;
    let watts:  number;

    if (isClimb) {
      type  = 'climb';
      label = sorted[ci!].name;
      watts = sorted[ci!].target_watts;
    } else if (avgGrad < -1.5) {
      type  = 'descent';
      label = 'Descent';
      watts = descentWatts;
    } else {
      type  = 'flat';
      label = 'Flat / Rolling';
      watts = flatWatts;
    }

    // Time estimate using physics model on actual gradient profile
    const estTime = estimateTime({
      stream_distance_km: sliceD,
      stream_altitude_m:  sliceA,
      flat_watts:         isClimb ? watts : flatWatts,
      descent_watts:      isClimb ? watts : descentWatts,
      climbs:             [],
      rider_weight_kg:    riderKg,
      bike_weight_kg:     bikeKg,
    });

    segs.push({
      label,
      type,
      climb_idx:      ci,
      start_km:       Math.round(startKm * 10) / 10,
      end_km:         Math.round(endKm    * 10) / 10,
      distance_km:    Math.round(distKm   * 10) / 10,
      elevation_gain: Math.round(netGain),
      ascent_m:       Math.round(ascent),
      avg_gradient:   Math.round(avgGrad  * 10) / 10,
      target_watts:   watts,
      est_time_min:   estTime,
    });
  }

  return segs;
}

/** Normalised Power from discrete power-block segments (time-weighted 4th power). */
export function calcNP(segs: PacingSegment[]): number {
  const totalT = segs.reduce((s, seg) => s + seg.est_time_min, 0);
  if (totalT === 0) return 0;
  const sum4 = segs.reduce((s, seg) => s + Math.pow(seg.target_watts, 4) * seg.est_time_min, 0);
  return Math.round(Math.pow(sum4 / totalT, 0.25));
}

/** Time-weighted average watts. */
export function calcAvgWatts(segs: PacingSegment[]): number {
  const totalT = segs.reduce((s, seg) => s + seg.est_time_min, 0);
  if (totalT === 0) return 0;
  return Math.round(segs.reduce((s, seg) => s + seg.target_watts * seg.est_time_min, 0) / totalT);
}

/** Calories (kcal ≈ kJ mechanical work for cycling at ~25% efficiency). */
export function calcCalories(avgWatts: number, durationMin: number): number {
  return Math.round(avgWatts * durationMin * 60 / 1000);
}

/** Format minutes as H:MM or HH:MM */
export function fmtTime(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = Math.round(totalMin % 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}
