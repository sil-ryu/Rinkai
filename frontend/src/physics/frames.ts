import { eciToEcf, eciToGeodetic, gstime } from "satellite.js";
import { ARCSEC, DEG, J2000_JD, MS_PER_DAY, UNIX_EPOCH_JD } from "./constants";

export type Vec3 = { x: number; y: number; z: number };
export type Geodetic = { latDeg: number; lonDeg: number; altKm: number };

export const julianDate = (date: Date): number => date.getTime() / MS_PER_DAY + UNIX_EPOCH_JD;

/** Greenwich mean sidereal time (rad), IAU-82, as used by SGP4/TEME. */
export const gmst = (date: Date): number => gstime(date);

/**
 * IAU-1976 precession: rotate a J2000 (EME2000) vector to mean-of-date.
 * Nutation is ignored (<~20 arcsec, about 0.6 km at ISS altitude), fine for display.
 * UTC is used in place of TT (a ~1 minute difference, negligible for precession).
 */
export function j2000ToMeanOfDate(v: Vec3, date: Date): Vec3 {
  const T = (julianDate(date) - J2000_JD) / 36525;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T ** 3) * ARCSEC;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T ** 3) * ARCSEC;
  const th = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T ** 3) * ARCSEC;
  const [cz, sz, cZ, sZ, ct, st] = [
    Math.cos(zeta),
    Math.sin(zeta),
    Math.cos(z),
    Math.sin(z),
    Math.cos(th),
    Math.sin(th),
  ];
  return {
    x: (cz * ct * cZ - sz * sZ) * v.x + (-sz * ct * cZ - cz * sZ) * v.y + -st * cZ * v.z,
    y: (cz * ct * sZ + sz * cZ) * v.x + (-sz * ct * sZ + cz * cZ) * v.y + -st * sZ * v.z,
    z: cz * st * v.x + -sz * st * v.y + ct * v.z,
  };
}

/** Earth-fixed position (km) from an inertial-of-date vector (TEME or mean-of-date, km). */
export function inertialOfDateToEcefKm(v: Vec3, date: Date): Vec3 {
  return eciToEcf(v, gmst(date));
}

export function inertialOfDateToGeodetic(v: Vec3, date: Date): Geodetic {
  const g = eciToGeodetic(v, gmst(date));
  return { latDeg: g.latitude / DEG, lonDeg: normalizeLonDeg(g.longitude / DEG), altKm: g.height };
}

export function normalizeLonDeg(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Great-circle distance (km) on a sphere of radius r, plus altitude difference, combined. */
export function separationKm(a: Geodetic, b: Geodetic, r = 6371): number {
  const [p1, p2] = [a.latDeg * DEG, b.latDeg * DEG];
  const dp = p2 - p1;
  const dl = (b.lonDeg - a.lonDeg) * DEG;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const ground = 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
  return Math.hypot(ground, a.altKm - b.altKm);
}
