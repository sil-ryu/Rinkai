/// <reference lib="webworker" />
import {
  gstime,
  json2satrec,
  propagate,
  twoline2satrec,
  type OMMJsonObject,
  type SatRec,
} from "satellite.js";

/**
 * Propagates the whole satellite catalogue with SGP4 off the main thread.
 * Output per satellite (scene axes = ECEF (x, z, -y), km and km/s):
 *   pos: Earth-fixed position, vel: Earth-fixed velocity (inertial velocity minus ω × r),
 * so the GPU can extrapolate positions between updates without touching the CPU.
 */
type Rec = { id: number; omm?: OMMJsonObject; tle?: [string, string] };
// `gen` tags each catalogue so results computed for an older one are ignored after a swap.
export type WorkerIn =
  { type: "init"; gen: number; records: Rec[] } | { type: "propagate"; gen: number; t: number };
export type WorkerOut =
  | { type: "ready"; gen: number; count: number; failed: number }
  | { type: "state"; gen: number; t: number; pos: Float32Array; vel: Float32Array; ms: number };

const OMEGA_EARTH = 7.2921158553e-5; // rad/s
let sats: (SatRec | null)[] = [];
let gen = 0;

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  if (msg.type === "init") {
    gen = msg.gen;
    let failed = 0;
    sats = msg.records.map((r) => {
      try {
        const s = r.omm ? json2satrec(r.omm) : r.tle ? twoline2satrec(r.tle[0], r.tle[1]) : null;
        if (!s || s.error) failed++;
        return s && !s.error ? s : null;
      } catch {
        failed++;
        return null;
      }
    });
    post({ type: "ready", gen, count: sats.length, failed });
    return;
  }
  if (msg.type === "propagate") {
    if (msg.gen !== gen) return; // stale request for a replaced catalogue
    const t0 = performance.now();
    const n = sats.length;
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const date = new Date(msg.t);
    const g = gstime(date);
    const c = Math.cos(g);
    const s = Math.sin(g);
    for (let i = 0; i < n; i++) {
      const sat = sats[i];
      if (!sat) continue; // stays at the origin; the shader hides it
      const pv = propagate(sat, date);
      const p = pv?.position;
      const v = pv?.velocity;
      if (!p || typeof p === "boolean" || !v || typeof v === "boolean") continue;
      // TEME -> ECEF (rotation by GMST about z)
      const x = c * p.x + s * p.y;
      const y = -s * p.x + c * p.y;
      const z = p.z;
      const vx = c * v.x + s * v.y + OMEGA_EARTH * y;
      const vy = -s * v.x + c * v.y - OMEGA_EARTH * x;
      const vz = v.z;
      // ECEF -> scene axes (x, z, -y)
      pos[i * 3] = x;
      pos[i * 3 + 1] = z;
      pos[i * 3 + 2] = -y;
      vel[i * 3] = vx;
      vel[i * 3 + 1] = vz;
      vel[i * 3 + 2] = -vy;
    }
    post({ type: "state", gen, t: msg.t, pos, vel, ms: performance.now() - t0 }, [pos.buffer, vel.buffer]);
  }
};

function post(m: WorkerOut, transfer: Transferable[] = []) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);
}
