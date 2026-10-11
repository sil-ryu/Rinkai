import { moonPositionInertial } from "../physics/moon";
import { sunDirectionInertial } from "../physics/sun";

/**
 * Orbital dynamics for player-controlled craft. Units: km, s. Frame: Earth-centred inertial of
 * date (the same frame SGP4's TEME and our Moon/Sun series approximate, to well under a degree).
 */
export const MU_EARTH = 398_600.4418; // km^3/s^2
export const MU_MOON = 4_902.800066;
export const MU_SUN = 132_712_440_018;
export const R_EARTH = 6378.137;
export const R_MOON = 1737.4;
export const J2 = 1.08262668e-3;
export const AU_KM = 149_597_870.7;

export type V3 = [number, number, number];
export type State = { r: V3; v: V3 };

export type Bodies = { moon: V3; sun: V3 };

/** Moon and Sun positions (km, inertial of date) at `tMs`. */
export function bodiesAt(tMs: number): Bodies {
  const d = new Date(tMs);
  const m = moonPositionInertial(d);
  const s = sunDirectionInertial(d);
  return { moon: [m.x, m.y, m.z], sun: [s.x * AU_KM, s.y * AU_KM, s.z * AU_KM] };
}

/** Third-body perturbation (Battin's form, numerically safe for |d| << |s|). */
function thirdBody(r: V3, s: V3, mu: number, out: V3) {
  const dx = s[0] - r[0];
  const dy = s[1] - r[1];
  const dz = s[2] - r[2];
  const d3 = Math.hypot(dx, dy, dz) ** 3;
  const s3 = Math.hypot(s[0], s[1], s[2]) ** 3;
  out[0] += mu * (dx / d3 - s[0] / s3);
  out[1] += mu * (dy / d3 - s[1] / s3);
  out[2] += mu * (dz / d3 - s[2] / s3);
}

export type GravityOpts = { j2?: boolean; moon?: boolean; sun?: boolean };

/** Gravitational acceleration (km/s^2) at r: Earth point mass + J2, Moon and Sun third-body terms. */
export function gravity(r: V3, bodies: Bodies | null, opts: GravityOpts = {}, out: V3 = [0, 0, 0]): V3 {
  const [x, y, z] = r;
  const r2 = x * x + y * y + z * z;
  const rn = Math.sqrt(r2);
  const k = -MU_EARTH / (r2 * rn);
  out[0] = k * x;
  out[1] = k * y;
  out[2] = k * z;
  if (opts.j2 !== false) {
    const f = (1.5 * J2 * MU_EARTH * R_EARTH * R_EARTH) / (r2 * r2 * rn);
    const zz = (5 * z * z) / r2;
    out[0] += f * x * (zz - 1);
    out[1] += f * y * (zz - 1);
    out[2] += f * z * (zz - 3);
  }
  if (bodies && opts.moon !== false) thirdBody(r, bodies.moon, MU_MOON, out);
  if (bodies && opts.sun !== false) thirdBody(r, bodies.sun, MU_SUN, out);
  return out;
}

/** One RK4 step of dt seconds with an extra constant acceleration (thrust) in km/s^2. */
export function rk4(
  s: State,
  dt: number,
  bodies: Bodies | null,
  thrust: V3 = [0, 0, 0],
  opts: GravityOpts = {},
): State {
  const a = (r: V3): V3 => {
    const g = gravity(r, bodies, opts);
    return [g[0] + thrust[0], g[1] + thrust[1], g[2] + thrust[2]];
  };
  const add = (p: V3, q: V3, h: number): V3 => [p[0] + q[0] * h, p[1] + q[1] * h, p[2] + q[2] * h];
  const k1v = a(s.r);
  const k1r = s.v;
  const k2v = a(add(s.r, k1r, dt / 2));
  const k2r = add(s.v, k1v, dt / 2);
  const k3v = a(add(s.r, k2r, dt / 2));
  const k3r = add(s.v, k2v, dt / 2);
  const k4v = a(add(s.r, k3r, dt));
  const k4r = add(s.v, k3v, dt);
  const comb = (p: V3, a1: V3, a2: V3, a3: V3, a4: V3): V3 => [
    p[0] + (dt / 6) * (a1[0] + 2 * a2[0] + 2 * a3[0] + a4[0]),
    p[1] + (dt / 6) * (a1[1] + 2 * a2[1] + 2 * a3[1] + a4[1]),
    p[2] + (dt / 6) * (a1[2] + 2 * a2[2] + 2 * a3[2] + a4[2]),
  ];
  return { r: comb(s.r, k1r, k2r, k3r, k4r), v: comb(s.v, k1v, k2v, k3v, k4v) };
}

/** A stable step size: ~1/600 of the local orbital time scale around Earth (and the Moon when close). */
export function stepSize(r: V3, bodies: Bodies | null): number {
  const re = Math.hypot(r[0], r[1], r[2]);
  let tau = Math.sqrt((re * re * re) / MU_EARTH);
  if (bodies) {
    const rm = Math.hypot(r[0] - bodies.moon[0], r[1] - bodies.moon[1], r[2] - bodies.moon[2]);
    tau = Math.min(tau, Math.sqrt((rm * rm * rm) / MU_MOON));
  }
  return Math.min(Math.max(tau / 100, 0.05), 120);
}

export type Elements = {
  a: number; // km (negative for hyperbolic)
  e: number;
  incDeg: number;
  periodS: number | null; // null when unbound
  apoAltKm: number | null;
  periAltKm: number;
  energy: number; // km^2/s^2
};

/** Osculating two-body elements about Earth. */
export function elements(s: State): Elements {
  const [x, y, z] = s.r;
  const [vx, vy, vz] = s.v;
  const r = Math.hypot(x, y, z);
  const v2 = vx * vx + vy * vy + vz * vz;
  const energy = v2 / 2 - MU_EARTH / r;
  const h: V3 = [y * vz - z * vy, z * vx - x * vz, x * vy - y * vx];
  const hn = Math.hypot(...h);
  const rv = x * vx + y * vy + z * vz;
  const ev: V3 = [
    ((v2 - MU_EARTH / r) * x - rv * vx) / MU_EARTH,
    ((v2 - MU_EARTH / r) * y - rv * vy) / MU_EARTH,
    ((v2 - MU_EARTH / r) * z - rv * vz) / MU_EARTH,
  ];
  const e = Math.hypot(...ev);
  const a = -MU_EARTH / (2 * energy);
  const p = (hn * hn) / MU_EARTH;
  const bound = energy < 0 && e < 1;
  return {
    a,
    e,
    incDeg: (Math.acos(Math.max(-1, Math.min(1, h[2] / hn))) * 180) / Math.PI,
    periodS: bound ? 2 * Math.PI * Math.sqrt((a * a * a) / MU_EARTH) : null,
    apoAltKm: bound ? a * (1 + e) - R_EARTH : null,
    periAltKm: p / (1 + e) - R_EARTH,
    energy,
  };
}

export type PathPoint = { t: number; r: V3 };
export type Prediction = { points: PathPoint[]; impact: "earth" | "moon" | null; impactT: number | null };

/**
 * Coast prediction (no thrust) from `s` at sim time `tMs`, sampled at `samples` points over
 * `horizonS` seconds, stopping at an impact with Earth or the Moon.
 */
export function predict(s: State, tMs: number, horizonS: number, samples = 360): Prediction {
  const points: PathPoint[] = [{ t: tMs, r: [...s.r] }];
  let st = s;
  let t = 0;
  const every = horizonS / samples;
  let next = every;
  let bodies = bodiesAt(tMs);
  let bodiesT = 0;
  while (t < horizonS) {
    if (t - bodiesT > 3600) {
      bodies = bodiesAt(tMs + t * 1000);
      bodiesT = t;
    }
    const dt = Math.min(stepSize(st.r, bodies) * 4, next - t, 600);
    st = rk4(st, dt, bodies);
    t += dt;
    const re = Math.hypot(...st.r);
    if (re < R_EARTH)
      return {
        points: [...points, { t: tMs + t * 1000, r: st.r }],
        impact: "earth",
        impactT: tMs + t * 1000,
      };
    const m = bodies.moon;
    if (Math.hypot(st.r[0] - m[0], st.r[1] - m[1], st.r[2] - m[2]) < R_MOON) {
      return { points: [...points, { t: tMs + t * 1000, r: st.r }], impact: "moon", impactT: tMs + t * 1000 };
    }
    if (t >= next - 1e-9) {
      points.push({ t: tMs + t * 1000, r: [...st.r] });
      next += every;
    }
  }
  return { points, impact: null, impactT: null };
}

/** Circular-orbit state at altitude/inclination, starting at the ascending node along +x. */
export function circularOrbit(altKm: number, incDeg: number, raanDeg = 0): State {
  const r = R_EARTH + altKm;
  const v = Math.sqrt(MU_EARTH / r);
  const i = (incDeg * Math.PI) / 180;
  const O = (raanDeg * Math.PI) / 180;
  return {
    r: [r * Math.cos(O), r * Math.sin(O), 0],
    v: [-v * Math.sin(O) * Math.cos(i), v * Math.cos(O) * Math.cos(i), v * Math.sin(i)],
  };
}
