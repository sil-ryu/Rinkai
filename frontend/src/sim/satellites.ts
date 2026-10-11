import { json2satrec, propagate, twoline2satrec, type SatRec } from "satellite.js";
import type { SatRecord } from "../data/api";
import { ownerGroup } from "../data/satCategories";
import { R_EARTH_EQ_KM } from "../physics/constants";
import { gmst, inertialOfDateToGeodetic, type Vec3 } from "../physics/frames";
import { sunDirectionInertial } from "../physics/sun";
import type { SatFilter } from "../store/liveSky";

export function satrecOf(r: SatRecord): SatRec | null {
  try {
    const s = r.omm ? json2satrec(r.omm) : r.tle ? twoline2satrec(r.tle[0], r.tle[1]) : null;
    return s && !s.error ? s : null;
  } catch {
    return null;
  }
}

/** 1 = shown, 0 = hidden, per record. Query matches name or NORAD id (case-insensitive). */
export function visibilityMask(records: SatRecord[], f: SatFilter): Float32Array {
  const q = f.query.trim().toUpperCase();
  const out = new Float32Array(records.length);
  records.forEach((r, i) => {
    const ok =
      (f.cats[r.cat] ?? true) &&
      (f.owners[ownerGroup(r.cc)] ?? true) &&
      (!q || r.name.toUpperCase().includes(q) || String(r.id) === q);
    out[i] = ok ? 1 : 0;
  });
  return out;
}

/** Orbit period in minutes from SGP4 mean motion (rad/min). */
export const periodMin = (s: SatRec): number => (2 * Math.PI) / s.no;

/**
 * One full orbit as Earth-fixed points (km), all rotated with the Earth orientation at `date`:
 * the inertial ellipse drawn as it sits around the planet right now.
 */
export function orbitRing(s: SatRec, date: Date, points = 181): Vec3[] {
  const P = periodMin(s) * 60_000;
  const g = gmst(date);
  const c = Math.cos(g);
  const sn = Math.sin(g);
  const out: Vec3[] = [];
  for (let k = 0; k < points; k++) {
    const pv = propagate(s, new Date(date.getTime() + (k / (points - 1)) * P));
    const p = pv?.position;
    if (!p || typeof p === "boolean") continue;
    out.push({ x: c * p.x + sn * p.y, y: -sn * p.x + c * p.y, z: p.z });
  }
  return out;
}

export type SatDetails = {
  latDeg: number;
  lonDeg: number;
  altKm: number;
  speedKmS: number;
  inclDeg: number;
  periodMin: number;
  perigeeKm: number;
  apogeeKm: number;
  sunlit: boolean;
  epochAgeH: number;
};

export function satDetails(s: SatRec, date: Date): SatDetails | null {
  const pv = propagate(s, date);
  const p = pv?.position;
  const v = pv?.velocity;
  if (!p || typeof p === "boolean" || !v || typeof v === "boolean") return null;
  const geo = inertialOfDateToGeodetic(p, date);
  const sun = sunDirectionInertial(date);
  const along = p.x * sun.x + p.y * sun.y + p.z * sun.z;
  const perp = Math.hypot(p.x - along * sun.x, p.y - along * sun.y, p.z - along * sun.z);
  // Semi-major axis from SGP4's mean motion (Earth radii), then apsides above the equatorial radius.
  const aKm = s.a * R_EARTH_EQ_KM;
  const epochMs =
    Date.UTC(2000 + (s.epochyr < 57 ? s.epochyr : s.epochyr - 100), 0, 1) + (s.epochdays - 1) * 86_400_000;
  return {
    ...geo,
    speedKmS: Math.hypot(v.x, v.y, v.z),
    inclDeg: (s.inclo * 180) / Math.PI,
    periodMin: periodMin(s),
    perigeeKm: aKm * (1 - s.ecco) - R_EARTH_EQ_KM,
    apogeeKm: aKm * (1 + s.ecco) - R_EARTH_EQ_KM,
    sunlit: along > 0 || perp > R_EARTH_EQ_KM,
    epochAgeH: (date.getTime() - epochMs) / 3_600_000,
  };
}
