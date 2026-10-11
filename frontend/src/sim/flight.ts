import { propagate, type SatRec } from "satellite.js";
import { inertialOfDateToEcefKm, type Vec3 } from "../physics/frames";
import {
  bodiesAt,
  circularOrbit,
  elements,
  MU_MOON,
  predict,
  R_EARTH,
  R_MOON,
  type State,
  type V3,
} from "./orbit";
import { Ship, type ShipEvent, type ShipInput, type TargetFn } from "./ship";

export type SpawnKind = "iss" | "tiangong" | "leo" | "geo" | "moon";

export const SPAWNS: { id: SpawnKind; label: string; hint: string }[] = [
  { id: "iss", label: "Near the ISS", hint: "300 m behind, matched orbit — try docking" },
  { id: "tiangong", label: "Near Tiangong", hint: "300 m behind, matched orbit — try docking" },
  { id: "leo", label: "Low Earth orbit", hint: "400 km circular, 51.6°" },
  { id: "geo", label: "Geostationary orbit", hint: "35,786 km over the equator" },
  { id: "moon", label: "Low lunar orbit", hint: "100 km above the Moon" },
];

const MOON_SOI_KM = 66_100;

/** SGP4 as a target function (TEME, km, km/s). */
export function satrecTarget(s: SatRec): TargetFn {
  return (tMs) => {
    const pv = propagate(s, new Date(tMs));
    const p = pv?.position;
    const v = pv?.velocity;
    if (!p || typeof p === "boolean" || !v || typeof v === "boolean") return null;
    return { r: [p.x, p.y, p.z], v: [v.x, v.y, v.z] };
  };
}

export type Telemetry = {
  status: Ship["status"];
  refBody: "Earth" | "Moon";
  altKm: number;
  speedKms: number;
  apoAltKm: number | null;
  periAltKm: number;
  periodS: number | null;
  incDeg: number;
  throttle: number;
  sas: Ship["sas"];
  dvUsedKms: number;
  fuelPct: number | null;
  target: { name: string; rangeKm: number; relSpeedKms: number; closingKms: number } | null;
  impact: "earth" | "moon" | null;
  impactInS: number | null;
};

export type Path = {
  points: Vec3[];
  markers: { pos: Vec3; text: string; kind: "apo" | "peri" | "impact" }[];
};

class FlightController {
  ship: Ship | null = null;
  private lastT: number | null = null;
  private targetId: string | null = null;
  private lastPrediction: ReturnType<typeof predict> | null = null;

  spawn(kind: SpawnKind, tMs: number, satrecs: Partial<Record<"iss" | "tiangong", SatRec>>): string | null {
    let s: State;
    let target: { id: string; name: string; fn: TargetFn } | null = null;
    if (kind === "iss" || kind === "tiangong") {
      const rec = satrecs[kind];
      if (!rec) return "Station orbit data not loaded yet";
      const fn = satrecTarget(rec);
      const st = fn(tMs);
      if (!st) return "Could not propagate the station";
      const vn = Math.hypot(...st.v);
      const rn = Math.hypot(...st.r);
      // 300 m behind along-track and 30 m below, same velocity
      s = {
        r: st.r.map((c, i) => c - (st.v[i]! / vn) * 0.3 - (st.r[i]! / rn) * 0.03) as V3,
        v: [...st.v],
      };
      target = { id: kind, name: kind === "iss" ? "ISS" : "Tiangong", fn };
    } else if (kind === "leo") {
      s = circularOrbit(400, 51.6, ((tMs / 3.6e6) * 15) % 360);
    } else if (kind === "geo") {
      s = circularOrbit(35_786, 0.05, 0);
    } else {
      const b0 = bodiesAt(tMs);
      const b1 = bodiesAt(tMs + 60_000);
      const vm = b1.moon.map((c, i) => (c - b0.moon[i]!) / 60) as V3;
      const mn = Math.hypot(...b0.moon);
      const u = b0.moon.map((c) => -c / mn) as V3; // over the near side
      const h = cross(b0.moon, vm);
      const w = normalize(cross(h, u));
      const r = R_MOON + 100;
      const vc = Math.sqrt(MU_MOON / r);
      s = { r: b0.moon.map((c, i) => c + u[i]! * r) as V3, v: vm.map((c, i) => c + w[i]! * vc) as V3 };
    }
    this.ship = new Ship(s);
    this.lastT = tMs;
    this.targetId = null;
    if (target) this.setTarget(target.id, target.name, target.fn, tMs);
    return null;
  }

  despawn() {
    this.ship = null;
    this.lastT = null;
    this.targetId = null;
    this.lastPrediction = null;
  }

  get target() {
    return this.targetId;
  }

  setTarget(id: string | null, name: string | null, fn: TargetFn | null, tMs: number) {
    this.targetId = id;
    this.ship?.setTarget(name, fn, tMs);
  }

  /** Advance to sim time tMs. Large jumps (time skips) are capped at one hour per call. */
  update(tMs: number, inp: ShipInput): ShipEvent[] {
    const ship = this.ship;
    if (!ship) return [];
    const last = this.lastT ?? tMs;
    this.lastT = tMs;
    const dt = Math.min(Math.max((tMs - last) / 1000, 0), 3600);
    if (dt === 0) return [];
    return ship.step(last, dt, inp);
  }

  /** Coast prediction as Earth-fixed points (rotated with the Earth at `tMs`) with Ap/Pe/impact markers. */
  path(tMs: number): Path | null {
    const ship = this.ship;
    if (!ship) return null;
    const s: State = { r: ship.r, v: ship.v };
    const el = elements(s);
    const nearMoon = this.moonDistance(tMs) < MOON_SOI_KM;
    const horizon = nearMoon ? 4 * 3600 : el.periodS ? Math.min(el.periodS * 1.02, 3 * 86400) : 5 * 86400;
    const pred = predict(s, tMs, horizon, nearMoon ? 300 : 420);
    this.lastPrediction = pred;
    const date = new Date(tMs);
    const toEcef = (r: V3): Vec3 => inertialOfDateToEcefKm({ x: r[0], y: r[1], z: r[2] }, date);
    const points = pred.points.map((p) => toEcef(p.r));
    const markers: Path["markers"] = [];
    if (!nearMoon && pred.points.length > 3) {
      let iMax = 0;
      let iMin = 0;
      pred.points.forEach((p, i) => {
        const d = Math.hypot(...p.r);
        if (d > Math.hypot(...pred.points[iMax]!.r)) iMax = i;
        if (d < Math.hypot(...pred.points[iMin]!.r)) iMin = i;
      });
      if (el.e > 0.002) {
        markers.push({
          pos: points[iMax]!,
          text: `Ap ${fmtKm(Math.hypot(...pred.points[iMax]!.r) - R_EARTH)}`,
          kind: "apo",
        });
        markers.push({
          pos: points[iMin]!,
          text: `Pe ${fmtKm(Math.hypot(...pred.points[iMin]!.r) - R_EARTH)}`,
          kind: "peri",
        });
      }
    }
    if (pred.impact) markers.push({ pos: points.at(-1)!, text: `Impact (${pred.impact})`, kind: "impact" });
    return { points, markers };
  }

  private moonDistance(tMs: number): number {
    const ship = this.ship!;
    const m = bodiesAt(tMs).moon;
    return Math.hypot(ship.r[0] - m[0], ship.r[1] - m[1], ship.r[2] - m[2]);
  }

  telemetry(tMs: number): Telemetry | null {
    const ship = this.ship;
    if (!ship) return null;
    const el = elements({ r: ship.r, v: ship.v });
    const b = bodiesAt(tMs);
    const dm = Math.hypot(ship.r[0] - b.moon[0], ship.r[1] - b.moon[1], ship.r[2] - b.moon[2]);
    const nearMoon = dm < MOON_SOI_KM;
    const rel = ship.relative(tMs);
    let target: Telemetry["target"] = null;
    if (rel && ship.targetName) {
      const range = Math.hypot(...rel.rel.r);
      const rs = Math.hypot(...rel.rel.v);
      const closing =
        -(rel.rel.r[0] * rel.rel.v[0] + rel.rel.r[1] * rel.rel.v[1] + rel.rel.r[2] * rel.rel.v[2]) /
        (range || 1);
      target = { name: ship.targetName, rangeKm: range, relSpeedKms: rs, closingKms: closing };
    }
    const pred = this.lastPrediction;
    return {
      status: ship.status,
      refBody: nearMoon ? "Moon" : "Earth",
      altKm: nearMoon ? dm - R_MOON : Math.hypot(...ship.r) - R_EARTH,
      speedKms: Math.hypot(...ship.v),
      apoAltKm: el.apoAltKm,
      periAltKm: el.periAltKm,
      periodS: el.periodS,
      incDeg: el.incDeg,
      throttle: ship.throttle,
      sas: ship.sas,
      dvUsedKms: ship.dvUsedKms,
      fuelPct: ship.infiniteFuel ? null : (100 * ship.fuelKg) / 9_000,
      target,
      impact: pred?.impact ?? null,
      impactInS: pred?.impactT ? (pred.impactT - tMs) / 1000 : null,
    };
  }
}

export const flight = new FlightController();

export function fmtKm(km: number): string {
  if (Math.abs(km) >= 10_000) return `${Math.round(km).toLocaleString("en-US")} km`;
  if (Math.abs(km) >= 10) return `${km.toFixed(0)} km`;
  if (Math.abs(km) >= 1) return `${km.toFixed(2)} km`;
  return `${(km * 1000).toFixed(0)} m`;
}

const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
