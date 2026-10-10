import { inertialOfDateToEcefKm, inertialOfDateToGeodetic, j2000ToMeanOfDate, type Vec3 } from "./frames";
import type { SatState } from "./sgp4";

/** [t_unix_s, x, y, z, vx, vy, vz] in EME2000, km and km/s — as served by /api/iss/oem. */
export type OemState = [number, number, number, number, number, number, number];
export type OemSegment = { meta: Record<string, string>; states: OemState[] };

const ORDER = 8;

/**
 * Lagrange interpolation on the ORDER samples nearest to t. Works with uneven spacing
 * (NASA's file adds samples at traffic events). Returns null outside the segment's span.
 */
export function interpolateOem(states: OemState[], tUnixS: number): { pos: Vec3; vel: Vec3 } | null {
  const n = states.length;
  if (n < ORDER || tUnixS < states[0]![0] || tUnixS > states[n - 1]![0]) return null;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (states[mid]![0] <= tUnixS) lo = mid;
    else hi = mid;
  }
  const start = Math.min(Math.max(lo - ORDER / 2 + 1, 0), n - ORDER);
  const out = [0, 0, 0, 0, 0, 0];
  for (let i = start; i < start + ORDER; i++) {
    let w = 1;
    const ti = states[i]![0];
    for (let j = start; j < start + ORDER; j++) {
      if (j !== i) w *= (tUnixS - states[j]![0]) / (ti - states[j]![0]);
    }
    for (let k = 0; k < 6; k++) out[k]! += w * states[i]![k + 1]!;
  }
  const [x, y, z, vx, vy, vz] = out as [number, number, number, number, number, number];
  return { pos: { x, y, z }, vel: { x: vx, y: vy, z: vz } };
}

export function findSegment(segments: OemSegment[], tUnixS: number): OemSegment | null {
  return (
    segments.find((s) => s.states.length && s.states[0]![0] <= tUnixS && tUnixS <= s.states.at(-1)![0]) ??
    null
  );
}

/** ISS state from NASA's ephemeris at `date`, converted J2000 -> mean-of-date -> Earth-fixed. */
export function oemStateAt(segments: OemSegment[], date: Date): SatState | null {
  const t = date.getTime() / 1000;
  const seg = findSegment(segments, t);
  const s = seg && interpolateOem(seg.states, t);
  if (!s) return null;
  const mod = j2000ToMeanOfDate(s.pos, date);
  return {
    ...inertialOfDateToGeodetic(mod, date),
    posInertialKm: mod, // mean-of-date; differs from TEME by nutation only (< 1 km here)
    posEcefKm: inertialOfDateToEcefKm(mod, date),
    speedKmS: Math.hypot(s.vel.x, s.vel.y, s.vel.z),
  };
}
