import { DEG, J2000_JD } from "./constants";
import { gmst, inertialOfDateToEcefKm, julianDate, type Vec3 } from "./frames";

/**
 * Low-precision Sun direction (Astronomical Almanac, ~0.01 deg over 1950-2050).
 * Returns a unit vector in the equatorial inertial frame of date.
 */
export function sunDirectionInertial(date: Date): Vec3 {
  const n = julianDate(date) - J2000_JD;
  const L = (280.46 + 0.9856474 * n) * DEG;
  const g = (357.528 + 0.9856003 * n) * DEG;
  const lambda = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  return { x: Math.cos(lambda), y: Math.cos(eps) * Math.sin(lambda), z: Math.sin(eps) * Math.sin(lambda) };
}

export function sunDirectionEcef(date: Date): Vec3 {
  return inertialOfDateToEcefKm(sunDirectionInertial(date), date);
}

/** Subsolar point (deg) — handy for tests and the HUD. */
export function subsolarPoint(date: Date): { latDeg: number; lonDeg: number } {
  const s = sunDirectionInertial(date);
  const lat = Math.asin(s.z) / DEG;
  const ra = Math.atan2(s.y, s.x);
  let lon = (ra - gmst(date)) / DEG;
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  return { latDeg: lat, lonDeg: lon };
}
