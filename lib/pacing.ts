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
 */

const G    = 9.81;    // m/s²
const RHO  = 1.225;   // kg/m³ air density at sea level
const CDA  = 0.32;    // m²  (road cyclist in drops)
const CRR  = 0.004;   // rolling resistance coefficient
const V_MAX = 55 / 3.6; // max descent speed ≈ 55 km/h

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
  start_km:      number;
  end_km:        number;
  distance_km:   number;
  elevation_gain: number;
  avg_gradient:  number;
}

/**
 * Auto-detect significant climbs from elevation profile.
 * A climb must have: average gradient > minGradPct%, total gain > minGainM.
 */
export function detectClimbs(
  distKm:   number[],
  altM:     number[],
  minGradPct = 3,
  minGainM   = 80,
): DetectedClimb[] {
  const n = Math.min(distKm.length, altM.length);
  if (n < 2) return [];

  // Smooth altitude with a ~2km rolling window so small dips don't break climbs
  const SMOOTH_KM = 1.5;
  const smoothed  = altM.slice();
  for (let i = 0; i < n; i++) {
    let sum = 0, cnt = 0;
    for (let j = 0; j < n; j++) {
      if (Math.abs(distKm[j] - distKm[i]) <= SMOOTH_KM / 2) { sum += altM[j]; cnt++; }
    }
    smoothed[i] = cnt ? sum / cnt : altM[i];
  }

  // Mark each segment as climbing if smoothed gradient >= threshold
  const isClimbing = Array(n).fill(false);
  for (let i = 1; i < n; i++) {
    const dDist = (distKm[i] - distKm[i - 1]) * 1000;
    const dAlt  = smoothed[i] - smoothed[i - 1];
    if (dDist > 0 && (dAlt / dDist) * 100 >= minGradPct) isClimbing[i] = true;
  }

  // Group consecutive climbing segments
  const climbs: DetectedClimb[] = [];
  let startIdx: number | null = null;

  for (let i = 1; i <= n; i++) {
    const climbing = i < n && isClimbing[i];
    if (climbing && startIdx === null) {
      startIdx = i - 1;
    } else if (!climbing && startIdx !== null) {
      // End of a climbing section
      const endIdx = i - 1;
      const gain   = altM[endIdx] - altM[startIdx];
      const dist   = distKm[endIdx] - distKm[startIdx];
      if (gain >= minGainM && dist > 0) {
        climbs.push({
          start_km:      Math.round(distKm[startIdx] * 10) / 10,
          end_km:        Math.round(distKm[endIdx]   * 10) / 10,
          distance_km:   Math.round(dist * 10) / 10,
          elevation_gain: Math.round(gain),
          avg_gradient:  Math.round((gain / (dist * 1000)) * 1000) / 10,
        });
      }
      startIdx = null;
    }
  }

  // Merge climbs that are very close together (< 2km gap)
  const merged: DetectedClimb[] = [];
  for (const c of climbs) {
    const prev = merged[merged.length - 1];
    if (prev && c.start_km - prev.end_km < 2) {
      const gain = (prev.elevation_gain + c.elevation_gain);
      const dist = c.end_km - prev.start_km;
      merged[merged.length - 1] = {
        start_km:      prev.start_km,
        end_km:        c.end_km,
        distance_km:   Math.round(dist * 10) / 10,
        elevation_gain: gain,
        avg_gradient:  Math.round((gain / (dist * 1000)) * 1000) / 10,
      };
    } else {
      merged.push(c);
    }
  }

  return merged;
}

/** Format minutes as H:MM or HH:MM */
export function fmtTime(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = Math.round(totalMin % 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}
