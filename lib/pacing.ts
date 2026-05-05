/**
 * Physics-based cycling speed / time estimation.
 *
 * Model:
 *   P_wheel = P_input × ETA                   (drivetrain efficiency)
 *   P_wheel = P_gravity + P_rolling + P_aero
 *   P_gravity = m·g·grad·v          (grad = rise/run, negative = descent)
 *   P_rolling = Crr·m·g·v
 *   P_aero    = ½·CdA·ρ·v³
 *
 * Route integration:
 *   Streams are resampled to ~50 m steps so steep ramps are not averaged away.
 *   CdA scales with gradient (upright climbing vs low aero flats).
 *   Target watts vary slightly with grade (“climber’s rhythm”).
 *   Descents use latlng curvature to cap corner speeds (hairpins).
 *
 * Key accuracy levers:
 *   - ETA:  drivetrain efficiency (0.975 typical for clean chain)
 *   - CdA:  drag area — 0.35 sportive hoods, 0.32 drops, 0.25 TT tuck
 *   - CRR:  rolling resistance — 0.0045 training tires, 0.003 race tires
 *   - RHO:  air density — decreases with altitude (~11% lower at 1000 m)
 *
 * IMPORTANT: the climb time estimate is highly sensitive to rider weight.
 * Ensure Settings → Physical → Rider Weight is set correctly, and include
 * accessories (water, food, clothing) in the pacing strategy weight.
 */

const G     = 9.81;         // m/s²
const V_MAX = 80 / 3.6;    // m/s  hard cap (≈ 80 km/h); real limit is corners

/** Mandatory spacing for time integration — preserves steep pitches vs stream spacing. */
const ROUTE_SAMPLE_STEP_M = 50;

// Defaults — overridable per-call via the physics params below
const DEFAULT_RHO = 1.225;   // kg/m³  sea-level air density
const DEFAULT_CDA = 0.32;    // m²     drops position
const DEFAULT_CRR = 0.005;   // rolling resistance — realistic for training tires
const DEFAULT_ETA = 0.975;   // drivetrain efficiency (clean chain ≈ 97.5%)

function interpLinear(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (n === 0) return 0;
  if (n === 1 || x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0;
  while (lo + 1 < n && xs[lo + 1] < x) lo++;
  const hi = Math.min(lo + 1, n - 1);
  const span = xs[hi] - xs[lo];
  if (Math.abs(span) < 1e-12) return ys[lo];
  const t = (x - xs[lo]) / span;
  return ys[lo] + t * (ys[hi] - ys[lo]);
}

function interpLatLng(
  distKm: number[],
  latlng: [number, number][],
  dKm: number,
): [number, number] {
  const lats = latlng.map(p => p[0]);
  const lngs = latlng.map(p => p[1]);
  return [interpLinear(distKm, lats, dKm), interpLinear(distKm, lngs, dKm)];
}

/**
 * Resample distance / altitude (and optional latlng) to fixed spacing along-route.
 */
export function resampleRouteStreams(
  streamDistKm: number[],
  streamAltM: number[],
  stepM: number,
  streamLatLng?: [number, number][],
): { distKm: number[]; altM: number[]; latlng?: [number, number][] } {
  const n = Math.min(streamDistKm.length, streamAltM.length);
  if (n < 2) {
    return {
      distKm: streamDistKm.slice(),
      altM:   streamAltM.slice(),
      latlng: streamLatLng?.slice(),
    };
  }

  const d0 = streamDistKm[0];
  const d1 = streamDistKm[n - 1];
  const stepKm = stepM / 1000;
  const distKm: number[] = [];
  const altM: number[] = [];
  const useLl =
    !!(streamLatLng && streamLatLng.length === streamDistKm.length && streamLatLng.length === streamAltM.length);
  const latlngOut: [number, number][] | undefined = useLl ? [] : undefined;

  for (let d = d0; d < d1 - 1e-9; d += stepKm) {
    distKm.push(d);
    altM.push(interpLinear(streamDistKm, streamAltM, d));
    if (latlngOut) latlngOut.push(interpLatLng(streamDistKm, streamLatLng!, d));
  }
  distKm.push(d1);
  altM.push(streamAltM[n - 1]);
  if (latlngOut && streamLatLng) latlngOut.push(streamLatLng[n - 1]);

  return { distKm, altM, latlng: latlngOut };
}

/** Bearing from point a → b (degrees clockwise from north, 0–360). */
function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Smallest turn angle between two headings (degrees). */
function headingTurnDeg(hIn: number, hOut: number): number {
  const d = Math.abs(hIn - hOut) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Technical-descent speed limit from curvature at sample points (~50 m spacing).
 * Returns km/h cap or null when geometry does not tighten the allowable speed.
 */
export function cornerSpeedCapKmh(
  prev: [number, number],
  curr: [number, number],
  next: [number, number],
): number | null {
  const bearingIn  = bearingDeg(prev[0], prev[1], curr[0], curr[1]);
  const bearingOut = bearingDeg(curr[0], curr[1], next[0], next[1]);
  const turn       = headingTurnDeg(bearingIn, bearingOut);
  if (turn >= 55) return 28;
  if (turn >= 38) return 38;
  if (turn >= 22) return 48;
  if (turn >= 12) return 58;
  return null;
}

/** CdA multiplier vs baseline from rider position / drafting by gradient (fraction). */
function cdaGradeMultiplier(grad: number): number {
  if (grad > 0.03) return 1.10;
  if (grad >= -0.01 && grad <= 0.01) return 0.85;
  return 1;
}

/** Climber rhythm + flat-road energy saving (applied after climb/descent/flat watt selection). */
function wattGradeMultiplier(grad: number): number {
  let m = 1;
  if (grad > 0.06) m *= 1.10;
  if (grad >= -0.01 && grad <= 0.01) m *= 0.95;
  return m;
}

export interface PhysicsParams {
  cda?: number;   // drag area m²         (default 0.35)
  crr?: number;   // rolling resistance    (default 0.0045)
  rho?: number;   // air density kg/m³     (default 1.225)
  eta?: number;   // drivetrain efficiency (default 0.975)
}

/** Derive air density from average route altitude using barometric formula. */
export function rhoAtAltitude(avgAltM: number): number {
  return DEFAULT_RHO * Math.exp(-avgAltM / 8500);
}

/**
 * Return the steady-state speed (m/s) for a given power and gradient.
 * @param watts  Mechanical power at the pedals (before drivetrain loss)
 * @param grad   Slope as a fraction (e.g. 0.06 = 6% climb, -0.05 = 5% descent)
 * @param totalKg  Rider + bike + accessories mass in kg
 * @param p      Optional physics overrides
 */
export function speedForPower(
  watts: number,
  grad: number,
  totalKg: number,
  p: PhysicsParams = {},
): number {
  const cda = p.cda ?? DEFAULT_CDA;
  const crr = p.crr ?? DEFAULT_CRR;
  const rho = p.rho ?? DEFAULT_RHO;
  const eta = p.eta ?? DEFAULT_ETA;

  const sinGrade = Math.sin(Math.atan(grad));
  const cosGrade = Math.cos(Math.atan(grad));
  const effectiveW = watts * eta;
  // A·v + B·v³ = effectiveW   where A = gravity + rolling (linear), B = aero (cubic)
  const A = totalKg * G * (sinGrade + cosGrade * crr);
  const B = 0.5 * cda * rho;

  let v = grad > 0.03 ? 4.0 : grad < -0.03 ? V_MAX * 0.7 : 8.0;
  for (let i = 0; i < 60; i++) {
    const f  = A * v + B * v * v * v - effectiveW;
    const df = A + 3 * B * v * v;
    if (Math.abs(df) < 1e-12) break;
    const dv = f / df;
    v -= dv;
    v  = Math.min(Math.max(v, 0.3), V_MAX);
    if (Math.abs(dv) < 1e-6) break;
  }
  return Math.min(Math.max(v, 0.3), V_MAX);
}

/**
 * Return the power (watts) at the pedals required to sustain a given speed.
 * Inverse of speedForPower — direct calculation, no iteration needed.
 * @param speedMs  Speed in m/s
 * @param grad     Slope as a fraction
 * @param totalKg  Rider + bike + accessories mass in kg
 * @param p        Optional physics overrides
 */
export function powerForSpeed(
  speedMs: number,
  grad: number,
  totalKg: number,
  p: PhysicsParams = {},
): number {
  const cda = p.cda ?? DEFAULT_CDA;
  const crr = p.crr ?? DEFAULT_CRR;
  const rho = p.rho ?? DEFAULT_RHO;
  const eta = p.eta ?? DEFAULT_ETA;

  const sinGrade = Math.sin(Math.atan(grad));
  const cosGrade = Math.cos(Math.atan(grad));

  const gravityForce = totalKg * G * sinGrade;               // negative on downhill → reduces power needed
  const rollingForce = totalKg * G * cosGrade * crr;         // always opposes motion
  const dragForce    = 0.5 * cda * rho * speedMs * speedMs;  // always opposes motion

  const propulsivePower = (gravityForce + rollingForce + dragForce) * speedMs;
  if (propulsivePower <= 0) return 0;  // gravity does all the work — rider coasts
  return Math.round(propulsivePower / eta);
}

/**
 * Find the constant-power watts required to ride a real elevation segment
 * at a target average speed. Inverts the time integration in `estimateTime`
 * via binary search — necessary because gradient varies within a segment,
 * so `powerForSpeed(speed, avg_grad)` gives the wrong answer on rolling terrain.
 */
export function wattsForSegmentSpeed(
  streamDistKm:    number[],
  streamAltM:      number[],
  startKm:         number,
  endKm:           number,
  targetSpeedKmh:  number,
  riderKg:         number,
  bikeKg:          number,
  p:               PhysicsParams = {},
): number {
  const sliceD: number[] = [];
  const sliceA: number[] = [];
  for (let i = 0; i < streamDistKm.length; i++) {
    if (streamDistKm[i] >= startKm && streamDistKm[i] <= endKm) {
      sliceD.push(streamDistKm[i]);
      sliceA.push(streamAltM[i]);
    }
  }
  const cappedSpeedKmh = Math.min(targetSpeedKmh, V_MAX * 3.6);
  if (sliceD.length < 2 || cappedSpeedKmh <= 0) return 0;

  const distKm    = sliceD[sliceD.length - 1] - sliceD[0];
  const targetMin = (distKm / cappedSpeedKmh) * 60;

  let lo = 5, hi = 2000;
  for (let iter = 0; iter < 30; iter++) {
    const mid = (lo + hi) / 2;
    const t = estimateTime({
      stream_distance_km: sliceD,
      stream_altitude_m:  sliceA,
      flat_watts:         mid,
      descent_watts:      mid,
      climbs:             [],
      rider_weight_kg:    riderKg,
      bike_weight_kg:     bikeKg,
      physics:            p,
    });
    if (t > targetMin) lo = mid;
    else                hi = mid;
    if (hi - lo < 0.1)  break;
  }
  return Math.round((lo + hi) / 2);
}

export interface EventClimbInput {
  start_km:    number;
  end_km:      number;
  target_watts: number;
}

/** Optional km windows (e.g. from a reference ride) that cap descent speed — mimics braking / terrain limits. */
export interface SegmentSpeedCapZone {
  start_km: number;
  end_km:   number;
  max_kmh:  number;
}

export interface PacingInput {
  stream_distance_km:  number[];
  stream_altitude_m:   number[];
  /** Optional [lat,lng] per distance sample — enables descent corner caps when aligned with streams */
  stream_latlng?:      [number, number][];
  flat_watts:          number;
  flat_speed_kmh?:     number;
  descent_watts:       number;
  descent_speed_kmh?:  number;
  climbs:              EventClimbInput[];
  rider_weight_kg:     number;
  bike_weight_kg:      number;
  accessories_kg?:     number;
  physics?:            PhysicsParams;
  /** Extra descent speed ceilings (applied after global caps and corner geometry caps). */
  segment_speed_caps?: SegmentSpeedCapZone[];
}

/** Compute total estimated riding time in minutes. */
export function estimateTime(input: PacingInput): number {
  const {
    stream_distance_km, stream_altitude_m,
    stream_latlng,
    flat_watts, descent_watts, climbs,
    rider_weight_kg, bike_weight_kg,
    accessories_kg = 0,
    descent_speed_kmh, flat_speed_kmh,
    physics = {},
  } = input;

  const totalKg = rider_weight_kg + bike_weight_kg + accessories_kg;
  const baseCda = physics.cda ?? DEFAULT_CDA;

  const hi = resampleRouteStreams(
    stream_distance_km,
    stream_altitude_m,
    ROUTE_SAMPLE_STEP_M,
    stream_latlng,
  );
  const D = hi.distKm;
  const A = hi.altM;
  const L = hi.latlng;
  const n = D.length;
  if (n < 2) return 0;

  // ── Slope smoothing ──────────────────────────────────────────────────────
  // Pre-compute raw per-step grades, then apply a triangle-weighted moving
  // average over ±GRADE_SMOOTH_STEPS (each step ≈ 50 m → ±150 m each side).
  // This prevents single GPS altitude blips from producing 400W power spikes.
  const rawGrades = new Array<number>(n - 1);
  for (let i = 1; i < n; i++) {
    const dd = (D[i] - D[i - 1]) * 1000;
    rawGrades[i - 1] = dd > 0 ? (A[i] - A[i - 1]) / dd : 0;
  }
  const GRADE_SMOOTH_STEPS = 3;
  const smoothGrades = rawGrades.map((_, i) => {
    let sum = 0, wt = 0;
    for (let j = Math.max(0, i - GRADE_SMOOTH_STEPS); j <= Math.min(rawGrades.length - 1, i + GRADE_SMOOTH_STEPS); j++) {
      const w = GRADE_SMOOTH_STEPS + 1 - Math.abs(i - j);
      sum += rawGrades[j] * w;
      wt  += w;
    }
    return sum / wt;
  });

  // ── Momentum / kinetic energy ────────────────────────────────────────────
  // Speed blends exponentially toward the steady-state target over
  // MOMENTUM_M metres — short bumps or spikes no longer cause instant
  // speed drops (a rider carrying 50 km/h into a short kicker keeps most of it).
  // Hard caps (corners, user limits) are applied AFTER the blend so braking
  // overrides momentum instantly.
  const MOMENTUM_M = 200;

  // Initialise vCurrent at the steady-state for the first step.
  const grad0  = smoothGrades[0] ?? 0;
  const watts0 = (grad0 < -0.01 ? descent_watts : flat_watts) * wattGradeMultiplier(grad0);
  let vCurrent = speedForPower(
    watts0,
    grad0,
    totalKg,
    { ...physics, cda: baseCda * cdaGradeMultiplier(grad0) },
  );

  let totalSec = 0;

  for (let i = 1; i < n; i++) {
    const dDist = (D[i] - D[i - 1]) * 1000;
    if (dDist <= 0) continue;

    const grad = smoothGrades[i - 1];
    const km   = (D[i - 1] + D[i]) / 2;

    const climbMatch = climbs.find(c => km >= c.start_km && km <= c.end_km);
    let watts: number;
    if (climbMatch) {
      watts = climbMatch.target_watts;
    } else if (grad < -0.01) {
      watts = descent_watts;
    } else {
      watts = flat_watts;
    }

    watts *= wattGradeMultiplier(grad);

    const cdaSeg = baseCda * cdaGradeMultiplier(grad);
    const segmentPhysics: PhysicsParams = { ...physics, cda: cdaSeg };

    const vSteady = speedForPower(watts, grad, totalKg, segmentPhysics);

    // Blend toward steady-state — momentum smooths out short-duration spikes
    const alpha = 1 - Math.exp(-dDist / MOMENTUM_M);
    let v = vCurrent + alpha * (vSteady - vCurrent);
    v = Math.min(Math.max(v, 0.3), V_MAX);

    // Hard caps (braking) applied after momentum — these override it
    if (!climbMatch) {
      if (grad < -0.01 && descent_speed_kmh) {
        v = Math.min(v, descent_speed_kmh / 3.6);
      } else if (grad >= -0.01 && flat_speed_kmh) {
        v = Math.min(v, flat_speed_kmh / 3.6);
      }
    }

    if (grad < -0.01 && L && i >= 1 && i + 1 < L.length) {
      const capKmh = cornerSpeedCapKmh(L[i - 1], L[i], L[i + 1]);
      if (capKmh !== null) v = Math.min(v, capKmh / 3.6);
    }

    if (grad < -0.01 && input.segment_speed_caps?.length) {
      for (const z of input.segment_speed_caps) {
        if (km >= z.start_km - 1e-6 && km <= z.end_km + 1e-6) {
          v = Math.min(v, z.max_kmh / 3.6);
        }
      }
    }

    vCurrent  = v;
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
 *   33.6 km · 73.9 km · 83.9 km · 93.9 km · 146.7 km · 166.6 km · 200 km · 215 km
 *
 * Tiers ordered steepest-first; a segment qualifies by satisfying any one row.
 */
function qualifiesAsKeyClimb(distKm: number, gainM: number, gradPct: number): boolean {
  if (gradPct >= 10 && distKm >= 0.4  && gainM >= 50)  return true;
  if (gradPct >= 7  && distKm >= 0.6  && gainM >= 70)  return true;
  if (gradPct >= 5  && distKm >= 0.7  && gainM >= 70)  return true;
  if (gradPct >= 3  && distKm >= 1.2  && gainM >= 100) return true;
  if (gradPct >= 2  && distKm >= 5.0  && gainM >= 100) return true;
  return false;
}

export function detectClimbs(
  distKm: number[],
  altM:   number[],
): DetectedClimb[] {
  const n = Math.min(distKm.length, altM.length);
  if (n < 2) return [];

  const SMOOTH_KM = 0.5;
  const smoothed  = altM.slice();
  for (let i = 0; i < n; i++) {
    let sum = 0, cnt = 0;
    for (let j = 0; j < n; j++) {
      if (Math.abs(distKm[j] - distKm[i]) <= SMOOTH_KM / 2) { sum += altM[j]; cnt++; }
    }
    smoothed[i] = cnt ? sum / cnt : altM[i];
  }

  const isClimbing = Array(n).fill(false);
  for (let i = 1; i < n; i++) {
    const dDist = (distKm[i] - distKm[i - 1]) * 1000;
    const dAlt  = smoothed[i] - smoothed[i - 1];
    if (dDist > 0 && (dAlt / dDist) * 100 >= 1.0) isClimbing[i] = true;
  }

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
  ascent_m:       number;   // total m gained (always ≥ 0) — matches Strava's "total ascent"
  avg_gradient:   number;   // % (negative = downhill)
  target_watts:      number;
  avg_speed_kmh:     number;
  est_time_min:      number;
  isManualOverride?: boolean;
  /** Reference activity (matched window) — optional */
  prev_avg_watts?:     number | null;
  prev_avg_speed_kmh?: number | null;
  prev_time_min?:      number | null;
}

interface ClimbRef {
  name:         string;
  start_km:     number;
  end_km:       number;
  target_watts: number;
}

/** Slice route streams to a [start_km, end_km] interval (inclusive). */
export function sliceRouteStreams(
  streamDistKm: number[],
  streamAltM: number[],
  streamLatLng: [number, number][] | undefined,
  startKm: number,
  endKm: number,
): { sliceD: number[]; sliceA: number[]; sliceL?: [number, number][] } {
  const sliceD: number[] = [];
  const sliceA: number[] = [];
  const sliceL: [number, number][] | undefined =
    streamLatLng && streamLatLng.length === streamDistKm.length ? [] : undefined;
  for (let i = 0; i < streamDistKm.length; i++) {
    if (streamDistKm[i] >= startKm && streamDistKm[i] <= endKm) {
      sliceD.push(streamDistKm[i]);
      sliceA.push(streamAltM[i]);
      if (sliceL) sliceL.push(streamLatLng![i]);
    }
  }
  return { sliceD, sliceA, sliceL };
}

export function haversineDistanceMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const [lat1, lon1] = a;
  const [lat2, lon2] = b;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const aa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(Math.min(1, aa)), Math.sqrt(Math.max(0, 1 - aa)));
  return R * c;
}

const MATCH_TOL_KM = 0.08;
const LATLNG_REFINE_RADIUS = 40;

export interface ActivityStreamIndexWindow {
  startIdx: number;
  endIdx:   number;
}

/**
 * Map a pacing segment (route km + optional latlng) to activity stream indices
 * using cumulative distance along the reference activity, refined with GPS when available.
 */
export function matchPacingSegmentToActivityStream(
  seg: Pick<PacingSegment, 'start_km' | 'end_km'>,
  routeDistKm: number[],
  routeLatLng: [number, number][] | undefined,
  actDistKm: number[],
  actLatLng: [number, number][] | undefined,
): ActivityStreamIndexWindow | null {
  const n = actDistKm.length;
  if (n < 2 || routeDistKm.length < 2) return null;

  let startIdx = actDistKm.findIndex(d => d >= seg.start_km - MATCH_TOL_KM);
  if (startIdx < 0) startIdx = 0;

  let endIdx = n - 1;
  for (let i = n - 1; i >= 0; i--) {
    if (actDistKm[i] <= seg.end_km + MATCH_TOL_KM) {
      endIdx = i;
      break;
    }
  }

  if (startIdx >= endIdx) return null;

  const useRouteLl =
    routeLatLng && routeLatLng.length === routeDistKm.length;
  const useActLl = actLatLng && actLatLng.length === n;

  if (useRouteLl && useActLl) {
    const refStart = interpLatLng(routeDistKm, routeLatLng, seg.start_km);
    const refEnd   = interpLatLng(routeDistKm, routeLatLng, seg.end_km);
    const i0 = Math.max(0, startIdx - LATLNG_REFINE_RADIUS);
    const i1 = Math.min(n - 1, startIdx + LATLNG_REFINE_RADIUS);
    let bestI = startIdx;
    let bestD = Infinity;
    for (let i = i0; i <= i1; i++) {
      const dd = haversineDistanceMeters(refStart, actLatLng[i]);
      if (dd < bestD) { bestD = dd; bestI = i; }
    }
    startIdx = bestI;

    const j0 = Math.max(0, endIdx - LATLNG_REFINE_RADIUS);
    const j1 = Math.min(n - 1, endIdx + LATLNG_REFINE_RADIUS);
    let bestJ = endIdx;
    bestD = Infinity;
    for (let j = j0; j <= j1; j++) {
      const dd = haversineDistanceMeters(refEnd, actLatLng[j]);
      if (dd < bestD) { bestD = dd; bestJ = j; }
    }
    endIdx = bestJ;
  }

  if (startIdx >= endIdx) return null;
  return { startIdx, endIdx };
}

export interface ReferenceActivityStreamInput {
  distance_km:       number[];
  watts?:            (number | null)[] | null;
  latlng?:           [number, number][] | null;
  moving_time_sec:   number;
}

export function extractReferenceSegmentMetrics(
  startIdx: number,
  endIdx: number,
  actDistKm: number[],
  watts: (number | null)[] | null | undefined,
  movingTimeSec: number,
): Pick<PacingSegment, 'prev_avg_watts' | 'prev_avg_speed_kmh' | 'prev_time_min'> {
  if (startIdx >= endIdx || movingTimeSec <= 0) {
    return { prev_avg_watts: null, prev_avg_speed_kmh: null, prev_time_min: null };
  }

  const nAct = actDistKm.length;
  const d0 = actDistKm[startIdx];
  const d1 = actDistKm[endIdx];
  const segKm = Math.max(0, d1 - d0);
  const totalKm = Math.max(1e-9, actDistKm[nAct - 1] - actDistKm[0]);
  const elapsedSec = (segKm / totalKm) * movingTimeSec;
  const prev_time_min = elapsedSec / 60;

  let prev_avg_watts: number | null = null;
  if (watts) {
    const wSlice = watts.slice(startIdx, endIdx + 1).filter((w): w is number => w != null && w > 0);
    if (wSlice.length > 0) {
      prev_avg_watts = Math.round(wSlice.reduce((a, b) => a + b, 0) / wSlice.length);
    }
  }

  let prev_avg_speed_kmh: number | null = null;
  if (segKm > 0 && prev_time_min > 1e-6) {
    prev_avg_speed_kmh = Math.round((segKm / (prev_time_min / 60)) * 10) / 10;
  }

  return { prev_avg_watts, prev_avg_speed_kmh, prev_time_min };
}

export interface ApplyReferenceActivityParams {
  streamDistKm:      number[];
  streamAltM:        number[];
  streamLatLng?:     [number, number][];
  reference:         ReferenceActivityStreamInput;
  flatWatts:         number;
  descentWatts:      number;
  descentSpeedKmh?:  number;
  flatSpeedKmh?:     number;
  riderKg:           number;
  bikeKg:            number;
  accessoriesKg:     number;
  physics:           PhysicsParams;
  sortedClimbs:      ClimbRef[];
}

/**
 * Attach reference-ride metrics, apply reference descent speed caps, and calibrate segment times
 * so replaying reference power matches observed duration (per segment).
 */
export function applyReferenceActivityToPacingSegments(
  segments: PacingSegment[],
  p: ApplyReferenceActivityParams,
): PacingSegment[] {
  const ref = p.reference;
  if (!ref.distance_km?.length || ref.moving_time_sec <= 0) {
    return segments.map(s => ({
      ...s,
      prev_avg_watts: null,
      prev_avg_speed_kmh: null,
      prev_time_min: null,
    }));
  }

  const actLat = ref.latlng?.length === ref.distance_km.length ? ref.latlng : undefined;

  const withPrev = segments.map(seg => {
    const win = matchPacingSegmentToActivityStream(
      seg,
      p.streamDistKm,
      p.streamLatLng,
      ref.distance_km,
      actLat,
    );
    const metrics = win
      ? extractReferenceSegmentMetrics(
          win.startIdx,
          win.endIdx,
          ref.distance_km,
          ref.watts ?? null,
          ref.moving_time_sec,
        )
      : { prev_avg_watts: null, prev_avg_speed_kmh: null, prev_time_min: null };
    return { seg, metrics };
  });

  const refCaps: SegmentSpeedCapZone[] = withPrev
    .filter(
      x =>
        x.seg.type === 'descent' &&
        x.metrics.prev_avg_speed_kmh != null &&
        x.metrics.prev_avg_speed_kmh > 0,
    )
    .map(x => ({
      start_km: x.seg.start_km,
      end_km:   x.seg.end_km,
      max_kmh:  x.metrics.prev_avg_speed_kmh!,
    }));

  const resolvedPhysics: PhysicsParams = { ...p.physics };
  if (resolvedPhysics.rho === undefined && p.streamAltM.length > 0) {
    const avgAltM = p.streamAltM.reduce((a, b) => a + b, 0) / p.streamAltM.length;
    resolvedPhysics.rho = rhoAtAltitude(avgAltM);
  }

  return withPrev.map(({ seg, metrics }) => {
    const { sliceD, sliceA, sliceL } = sliceRouteStreams(
      p.streamDistKm,
      p.streamAltM,
      p.streamLatLng,
      seg.start_km,
      seg.end_km,
    );
    if (sliceD.length < 2) {
      return { ...seg, ...metrics };
    }

    const isClimb = seg.type === 'climb' && seg.climb_idx != null;
    const climbSlice: EventClimbInput[] = isClimb
      ? [{
          start_km:     sliceD[0],
          end_km:       sliceD[sliceD.length - 1],
          target_watts: p.sortedClimbs[seg.climb_idx!].target_watts,
        }]
      : [];

    const baseInput: PacingInput = {
      stream_distance_km: sliceD,
      stream_altitude_m:  sliceA,
      stream_latlng:      sliceL && sliceL.length === sliceD.length ? sliceL : undefined,
      flat_watts:         p.flatWatts,
      descent_watts:      p.descentWatts,
      flat_speed_kmh:     p.flatSpeedKmh,
      descent_speed_kmh:  p.descentSpeedKmh,
      climbs:             climbSlice,
      rider_weight_kg:    p.riderKg,
      bike_weight_kg:     p.bikeKg,
      accessories_kg:     p.accessoriesKg,
      physics:            resolvedPhysics,
      segment_speed_caps: refCaps.length ? refCaps : undefined,
    };

    const strategyTime = estimateTime(baseInput);

    let estMin = strategyTime;
    const pw = metrics.prev_avg_watts;
    const pt = metrics.prev_time_min;
    if (pw != null && pw > 0 && pt != null && pt > 0) {
      const refClimb: EventClimbInput[] = isClimb
        ? [{ start_km: sliceD[0], end_km: sliceD[sliceD.length - 1], target_watts: pw }]
        : [];
      const refModelTime = estimateTime({
        ...baseInput,
        flat_watts:    pw,
        descent_watts: pw,
        climbs:        refClimb,
      });
      if (refModelTime > 1e-4) {
        estMin = strategyTime * (pt / refModelTime);
      }
    }

    const avgSpeedKmh =
      seg.distance_km > 0 && estMin > 0
        ? Math.round((seg.distance_km / (estMin / 60)) * 10) / 10
        : 0;

    return {
      ...seg,
      ...metrics,
      est_time_min:  estMin,
      avg_speed_kmh: avgSpeedKmh,
    };
  });
}

/** Build a list of pacing segments from the full route + climb list. */
export function buildPacingSegments(
  streamDistKm:    number[],
  streamAltM:      number[],
  totalDistKm:     number,
  climbs:          ClimbRef[],
  flatWatts:       number,
  descentWatts:    number,
  riderKg:         number,
  bikeKg:          number,
  descentSpeedKmh?: number,
  flatSpeedKmh?:    number,
  accessoriesKg:    number = 0,
  physics:          PhysicsParams = {},
  streamLatLng?:    [number, number][],
): PacingSegment[] {
  // Compute altitude-corrected air density from full route stream if not overridden
  const resolvedPhysics: PhysicsParams = { ...physics };
  if (resolvedPhysics.rho === undefined && streamAltM.length > 0) {
    const avgAltM = streamAltM.reduce((a, b) => a + b, 0) / streamAltM.length;
    resolvedPhysics.rho = rhoAtAltitude(avgAltM);
  }

  const sorted = [...climbs].sort((a, b) => a.start_km - b.start_km);

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

    const { sliceD, sliceA, sliceL } = sliceRouteStreams(
      streamDistKm,
      streamAltM,
      streamLatLng,
      startKm,
      endKm,
    );
    if (sliceD.length < 2) continue;

    const netGain = sliceA[sliceA.length - 1] - sliceA[0];
    let ascent = 0;
    for (let i = 1; i < sliceA.length; i++) {
      const diff = sliceA[i] - sliceA[i - 1];
      if (diff > 0) ascent += diff;
    }
    const distKm    = endKm - startKm;
    const avgGrad   = distKm > 0 ? (netGain / (distKm * 1000)) * 100 : 0;

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

    const estTime = estimateTime({
      stream_distance_km: sliceD,
      stream_altitude_m:  sliceA,
      stream_latlng:      sliceL && sliceL.length === sliceD.length ? sliceL : undefined,
      flat_watts:         isClimb ? watts : flatWatts,
      descent_watts:      isClimb ? watts : descentWatts,
      climbs:             [],
      rider_weight_kg:    riderKg,
      bike_weight_kg:     bikeKg,
      accessories_kg:     accessoriesKg,
      descent_speed_kmh:  isClimb ? undefined : descentSpeedKmh,
      flat_speed_kmh:     isClimb ? undefined : flatSpeedKmh,
      physics:            resolvedPhysics,
    });

    const avgSpeedKmh = estTime > 0
      ? Math.round((distKm / (estTime / 60)) * 10) / 10
      : 0;

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
      avg_speed_kmh:  avgSpeedKmh,
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
