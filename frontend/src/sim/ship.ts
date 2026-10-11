import * as THREE from "three";
import { bodiesAt, gravity, R_EARTH, R_MOON, rk4, stepSize, type Bodies, type State, type V3 } from "./orbit";

/**
 * A player spacecraft: rigid body with a main engine, RCS translation and rate-commanded attitude.
 * Body axes: +x nose (thrust direction), +y top, +z right. Translational state is inertial (km, km/s).
 *
 * With a target (e.g. the ISS from SGP4), the ship integrates its position *relative* to the target
 * using the exact differential gravity a(rt + rel) - a(rt). The relative motion is then consistent
 * with the station you see, which is what makes rendezvous and docking possible.
 */
export type SasMode =
  | "off"
  | "stability"
  | "prograde"
  | "retrograde"
  | "normal"
  | "antinormal"
  | "radialOut"
  | "radialIn"
  | "target"
  | "antiTarget";

export type ShipInput = { pitch: number; yaw: number; roll: number; rcs: V3 /* fwd, up, right */ };
export const NO_INPUT: ShipInput = { pitch: 0, yaw: 0, roll: 0, rcs: [0, 0, 0] };

export type ShipEvent = "docked" | "undocked" | "impact-earth" | "impact-moon" | "collision";

const G0 = 9.80665;
const MAX_RATE = 0.35; // rad/s
const MAX_ANG_ACC = 0.6; // rad/s^2
const DOCK_RANGE_KM = 0.03;
const DOCK_SPEED_KMS = 0.0005;

export type TargetFn = (tMs: number) => State | null;

export class Ship {
  r: V3;
  v: V3;
  q = new THREE.Quaternion(); // body -> inertial
  w = new THREE.Vector3(); // body rates, rad/s
  dryMassKg = 9_000;
  fuelKg = 9_000;
  infiniteFuel = true;
  maxThrustN = 60_000;
  ispS = 320;
  rcsThrustN = 1_800;
  throttle = 0;
  sas: SasMode = "stability";
  dvUsedKms = 0;
  status: "flying" | "docked" | "crashed" = "flying";
  targetName: string | null = null;
  private targetFn: TargetFn | null = null;
  private rel: State | null = null;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private dq = new THREE.Quaternion();
  private dVec = new THREE.Vector3();
  private axisVec = new THREE.Vector3();

  constructor(s: State, noseDir?: V3) {
    this.r = [...s.r];
    this.v = [...s.v];
    this.pointNose(noseDir ?? s.v);
  }

  get massKg() {
    return this.dryMassKg + this.fuelKg;
  }

  /** Set (or clear) the rendezvous target; switches between absolute and relative integration. */
  setTarget(name: string | null, fn: TargetFn | null, tMs: number) {
    this.targetName = name;
    this.targetFn = fn;
    const t = fn?.(tMs);
    this.rel = t ? { r: sub(this.r, t.r), v: sub(this.v, t.v) } : null;
    if (!t && this.status === "docked") this.status = "flying";
  }

  /** Target state and the ship's state relative to it, if a target is set. */
  relative(tMs: number): { target: State; rel: State } | null {
    const t = this.targetFn?.(tMs);
    return t && this.rel ? { target: t, rel: this.rel } : null;
  }

  pointNose(dir: V3) {
    this.q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(...dir).normalize());
    this.w.set(0, 0, 0);
  }

  /** Advance by dtS seconds of sim time ending at tMs + dtS*1000. Returns events that occurred. */
  step(tMs: number, dtS: number, input: ShipInput, bodies: Bodies = bodiesAt(tMs)): ShipEvent[] {
    const events: ShipEvent[] = [];
    if (this.status === "crashed" || dtS <= 0) return events;
    const anyInput = input.pitch || input.yaw || input.roll || input.rcs.some((c) => c !== 0);
    if (this.status === "docked") {
      if (this.throttle > 0 || input.rcs.some((c) => c !== 0)) {
        this.status = "flying";
        events.push("undocked");
      } else {
        this.syncFromTarget(tMs + dtS * 1000);
        return events;
      }
    }

    this.stepAttitude(dtS, input, bodies, tMs);

    // Thrust (km/s^2, inertial) and fuel
    const m = this.massKg;
    const fuelOk = this.infiniteFuel || this.fuelKg > 0;
    const thrustN = fuelOk ? this.throttle * this.maxThrustN : 0;
    const rcsB = this.tmp
      .set(input.rcs[0], input.rcs[1], input.rcs[2])
      .multiplyScalar(fuelOk ? this.rcsThrustN : 0);
    const accB = this.tmp2
      .set(thrustN, 0, 0)
      .add(rcsB)
      .divideScalar(m * 1000);
    const acc = accB.applyQuaternion(this.q);
    const thrust: V3 = [acc.x, acc.y, acc.z];
    const accMag = acc.length();
    if (accMag > 0) {
      this.dvUsedKms += accMag * dtS;
      if (!this.infiniteFuel) {
        const mdot = (thrustN + rcsB.length()) / (this.ispS * G0);
        this.fuelKg = Math.max(0, this.fuelKg - mdot * dtS);
        if (this.fuelKg === 0) this.throttle = 0;
      }
    }

    // Translation, sub-stepped: finer while thrusting so finite burns are integrated accurately.
    let t = 0;
    while (t < dtS) {
      const h = Math.min(
        accMag > 0 ? Math.min(stepSize(this.r, bodies), 1) : stepSize(this.r, bodies),
        dtS - t,
      );
      const tNow = tMs + t * 1000;
      if (this.targetFn && this.rel) this.stepRelative(tNow, h, thrust, bodies);
      else {
        const s = rk4({ r: this.r, v: this.v }, h, bodies, thrust);
        this.r = s.r;
        this.v = s.v;
      }
      t += h;
      // impacts
      if (Math.hypot(...this.r) < R_EARTH) {
        this.status = "crashed";
        events.push("impact-earth");
        return events;
      }
      const mo = bodies.moon;
      if (Math.hypot(this.r[0] - mo[0], this.r[1] - mo[1], this.r[2] - mo[2]) < R_MOON) {
        this.status = "crashed";
        events.push("impact-moon");
        return events;
      }
    }

    // Docking / collision with the target
    if (this.rel) {
      const d = Math.hypot(...this.rel.r);
      const sp = Math.hypot(...this.rel.v);
      if (d < DOCK_RANGE_KM && sp < DOCK_SPEED_KMS && !anyInput && this.throttle === 0) {
        this.status = "docked";
        this.rel = { r: this.rel.r, v: [0, 0, 0] };
        this.w.set(0, 0, 0);
        events.push("docked");
      } else if (d < DOCK_RANGE_KM * 0.5 && sp > DOCK_SPEED_KMS * 4) {
        events.push("collision");
        // bounce: reverse and damp the closing velocity
        this.rel.v = this.rel.v.map((c) => -0.3 * c) as V3;
        this.syncFromTarget(tMs + dtS * 1000);
      }
    }
    return events;
  }

  private syncFromTarget(tMs: number) {
    const t = this.targetFn?.(tMs);
    if (!t || !this.rel) return;
    this.r = add(t.r, this.rel.r);
    this.v = add(t.v, this.rel.v);
  }

  /** RK4 on the relative state with differential gravity; target from its own propagator. */
  private stepRelative(tMs: number, h: number, thrust: V3, bodies: Bodies) {
    const T = (dt: number) => this.targetFn!(tMs + dt * 1000)!;
    const t0 = T(0);
    const tm = T(h / 2);
    const t1 = T(h);
    if (!t0 || !tm || !t1) return;
    const acc = (rt: V3, rel: V3): V3 => {
      const ga = gravity(add(rt, rel), bodies);
      const gb = gravity(rt, bodies);
      return [ga[0] - gb[0] + thrust[0], ga[1] - gb[1] + thrust[1], ga[2] - gb[2] + thrust[2]];
    };
    const s = this.rel!;
    const k1v = acc(t0.r, s.r);
    const k1r = s.v;
    const k2v = acc(tm.r, axpy(s.r, k1r, h / 2));
    const k2r = axpy(s.v, k1v, h / 2);
    const k3v = acc(tm.r, axpy(s.r, k2r, h / 2));
    const k3r = axpy(s.v, k2v, h / 2);
    const k4v = acc(t1.r, axpy(s.r, k3r, h));
    const k4r = axpy(s.v, k3v, h);
    const comb = (p: V3, a: V3, b: V3, c: V3, d: V3): V3 =>
      [0, 1, 2].map((i) => p[i]! + (h / 6) * (a[i]! + 2 * b[i]! + 2 * c[i]! + d[i]!)) as V3;
    this.rel = { r: comb(s.r, k1r, k2r, k3r, k4r), v: comb(s.v, k1v, k2v, k3v, k4v) };
    this.r = add(t1.r, this.rel.r);
    this.v = add(t1.v, this.rel.v);
  }

  /** Inertial direction for a SAS hold mode, or null. */
  sasDirection(mode: SasMode, tMs: number): V3 | null {
    const rel = this.relative(tMs);
    const r = this.r;
    const n = (x: V3): V3 => {
      const l = Math.hypot(...x) || 1;
      return [x[0] / l, x[1] / l, x[2] / l];
    };
    const h = cross(r, this.v);
    switch (mode) {
      case "prograde":
        return n(this.v);
      case "retrograde":
        return n(this.v).map((c) => -c) as V3;
      case "normal":
        return n(h);
      case "antinormal":
        return n(h).map((c) => -c) as V3;
      case "radialOut": {
        const rv = n(r);
        const vv = n(this.v);
        const d = rv[0] * vv[0] + rv[1] * vv[1] + rv[2] * vv[2];
        return n([rv[0] - d * vv[0], rv[1] - d * vv[1], rv[2] - d * vv[2]]);
      }
      case "radialIn": {
        const o = this.sasDirection("radialOut", tMs)!;
        return o.map((c) => -c) as V3;
      }
      case "target":
        return rel ? n(rel.rel.r.map((c) => -c) as V3) : null;
      case "antiTarget":
        return rel ? n(rel.rel.r) : null;
      default:
        return null;
    }
  }

  private stepAttitude(dtS: number, input: ShipInput, _bodies: Bodies, tMs: number) {
    const manual = input.pitch !== 0 || input.yaw !== 0 || input.roll !== 0;
    const dir = !manual ? this.sasDirection(this.sas, tMs) : null;
    // Under heavy time warp, holds snap to their direction instead of slewing for minutes.
    if (dir && dtS > 2) {
      this.pointNose(dir);
      return;
    }
    let left = Math.min(dtS, 2);
    while (left > 1e-9) {
      const h = Math.min(0.05, left);
      left -= h;
      const target = this.tmp.set(0, 0, 0);
      if (manual) {
        // W/S pitch about +z, A/D yaw about +y, Q/E roll about +x
        target.set(input.roll * MAX_RATE, input.yaw * MAX_RATE, input.pitch * MAX_RATE);
      } else if (dir) {
        const nose = this.tmp2.set(1, 0, 0).applyQuaternion(this.q);
        const d = this.dVec.set(dir[0], dir[1], dir[2]);
        const axis = this.axisVec.crossVectors(nose, d);
        const angle = Math.atan2(axis.length(), nose.dot(d));
        if (axis.lengthSq() < 1e-12 && angle > 1) axis.set(0, 0, 1).applyQuaternion(this.q); // 180 deg: any axis
        axis.normalize().applyQuaternion(this.dq.copy(this.q).invert()); // to body frame
        const rate = Math.min(MAX_RATE, 1.2 * angle);
        target.copy(axis).multiplyScalar(rate);
      } else if (this.sas === "off") {
        target.copy(this.w); // free spin
      }
      // rate controller with limited angular acceleration
      const err = this.tmp2.subVectors(target, this.w);
      const maxStep = MAX_ANG_ACC * h;
      if (err.length() > maxStep) err.setLength(maxStep);
      this.w.add(err);
      const wl = this.w.length();
      if (wl > 1e-9) {
        this.dq.setFromAxisAngle(this.tmp2.copy(this.w).divideScalar(wl), wl * h);
        this.q.multiply(this.dq).normalize();
      }
    }
  }
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const axpy = (a: V3, b: V3, k: number): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
