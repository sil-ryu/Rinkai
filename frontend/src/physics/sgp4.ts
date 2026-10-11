import { json2satrec, propagate, type OMMJsonObject, type SatRec } from "satellite.js";
import { inertialOfDateToEcefKm, inertialOfDateToGeodetic, type Geodetic, type Vec3 } from "./frames";

/** posInertialKm is TEME for SGP4 and mean-of-date for NASA OEM states (they differ by nutation only). */
export type SatState = Geodetic & {
  posInertialKm: Vec3;
  posEcefKm: Vec3;
  /** Unit inertial velocity expressed in Earth-fixed axes: the flight direction for LVLH attitude. */
  velDirEcef: Vec3;
  speedKmS: number;
};

export function satrecFromOmm(omm: OMMJsonObject): SatRec {
  return json2satrec(omm);
}

/** SGP4 state at `date`, or null if propagation fails (decayed or bad elements). Output frame is TEME. */
export function propagateSat(satrec: SatRec, date: Date): SatState | null {
  const pv = propagate(satrec, date);
  if (!pv || !pv.position || typeof pv.position === "boolean") return null;
  const posTemeKm = pv.position as Vec3;
  const v = pv.velocity as Vec3;
  return {
    ...inertialOfDateToGeodetic(posTemeKm, date),
    posInertialKm: posTemeKm,
    posEcefKm: inertialOfDateToEcefKm(posTemeKm, date),
    velDirEcef: unit(inertialOfDateToEcefKm(v, date)),
    speedKmS: Math.hypot(v.x, v.y, v.z),
  };
}

/** Hours since the element set's epoch (stale elements drift by a few km per day). */
export function elementAgeHours(omm: OMMJsonObject, date: Date): number {
  const epoch = Date.parse(omm.EPOCH.endsWith("Z") ? omm.EPOCH : omm.EPOCH + "Z");
  return (date.getTime() - epoch) / 3_600_000;
}

export function unit(v: Vec3): Vec3 {
  const n = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}
