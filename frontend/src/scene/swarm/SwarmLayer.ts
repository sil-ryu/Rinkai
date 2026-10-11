import * as THREE from "three";
import { R_EARTH_EQ_KM as R } from "../../physics/constants";
import type { WorkerIn, WorkerOut } from "./satWorker";

export type SwarmRecord = { id: number; color: string; omm?: unknown; tle?: [string, string] };

/**
 * Thousands of satellites as one Points draw call. A worker propagates them with SGP4; between
 * updates the vertex shader extrapolates with the Earth-fixed velocity (LEO error ~4 m after
 * 1 s, ~0.4 km after 10 s; updates are scheduled to keep the gap at or below ~10 s of sim time), so the main thread does no per-frame work. Points in Earth's shadow are dimmed, as they
 * would be to the eye.
 */
const vert = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 velocity;
  attribute vec3 color;
  attribute float visible;
  uniform float uDt;
  uniform float uSize;
  uniform vec3 uSun;
  uniform float uR;
  uniform float uSelected;
  attribute float satIndex;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec3 p = position + velocity * uDt;
    float valid = step(1000.0, length(position)) * visible;
    float along = dot(p, uSun);
    float shadow = (along < 0.0 && length(p - along * uSun) < uR) ? 1.0 : 0.0;
    float sel = 1.0 - step(0.5, abs(satIndex - uSelected));
    vColor = mix(color, vec3(1.0), sel * 0.5);
    vAlpha = valid * mix(1.0, 0.28, shadow);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = valid * (uSize + sel * 5.0);
    #include <logdepthbuf_vertex>
  }`;

const frag = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    #include <logdepthbuf_fragment>
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5 || vAlpha <= 0.0) discard;
    gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.5, 0.25, d));
  }`;

export class SwarmLayer {
  readonly points: THREE.Points;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;
  private worker: Worker;
  private n = 0;
  private stateT = 0;
  private pending = false;
  private lastRequest = 0;
  private ids: number[] = [];
  private gen = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  /** Sim time (ms) of the latest propagated state, or 0 before the first one. */
  get stateTime() {
    return this.stateT;
  }
  lastWorkerMs = 0;

  constructor(pixelRatio: number) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uDt: { value: 0 },
        uSize: { value: 2.4 * pixelRatio },
        uSun: { value: new THREE.Vector3(1, 0, 0) },
        uR: { value: R },
        uSelected: { value: -1 },
      },
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.worker = new Worker(new URL("./satWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<WorkerOut>) => this.onWorker(e.data);
  }

  setRecords(records: SwarmRecord[]) {
    this.n = records.length;
    this.ids = records.map((r) => r.id);
    const col = new Float32Array(this.n * 3);
    const c = new THREE.Color();
    records.forEach((r, i) => c.set(r.color).toArray(col, i * 3));
    this.geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.n * 3), 3));
    this.geo.setAttribute("velocity", new THREE.BufferAttribute(new Float32Array(this.n * 3), 3));
    this.geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.geo.setAttribute("visible", new THREE.BufferAttribute(new Float32Array(this.n).fill(1), 1));
    this.geo.setAttribute(
      "satIndex",
      new THREE.BufferAttribute(
        Float32Array.from({ length: this.n }, (_, i) => i),
        1,
      ),
    );
    this.stateT = 0;
    this.pending = false;
    this.gen++;
    this.worker.postMessage({
      type: "init",
      gen: this.gen,
      records: records.map(({ id, omm, tle }) => ({ id, omm, tle })),
    } as WorkerIn);
  }

  /** 1 = shown, 0 = filtered out, per record index. */
  setVisibility(mask: Float32Array) {
    const a = this.geo.getAttribute("visible") as THREE.BufferAttribute | undefined;
    if (!a || mask.length !== this.n) return;
    (a.array as Float32Array).set(mask);
    a.needsUpdate = true;
  }

  setSelected(index: number) {
    this.mat.uniforms.uSelected!.value = index;
  }

  /** Call every frame with the current sim time (ms) and Sun direction in world axes. */
  update(simMs: number, sunWorld: THREE.Vector3, rate: number) {
    this.mat.uniforms.uSun!.value.copy(sunWorld);
    // Extrapolate at most a couple of minutes; beyond that wait for the next worker state.
    this.mat.uniforms.uDt!.value = this.stateT
      ? THREE.MathUtils.clamp((simMs - this.stateT) / 1000, -180, 180)
      : 0;
    const now = performance.now();
    // Keep the extrapolation gap at or below ~10 s of sim time (<0.5 km in LEO); at 1x that is
    // one SGP4 pass per real second, at high warp the worker runs back to back.
    const minGap = Math.min(1000, 10_000 / Math.max(Math.abs(rate), 1e-6));
    if (this.n && !this.pending && now - this.lastRequest >= minGap) {
      this.pending = true;
      this.lastRequest = now;
      this.worker.postMessage({ type: "propagate", gen: this.gen, t: simMs } as WorkerIn);
    }
  }

  private onWorker(m: WorkerOut) {
    if (m.type !== "state" || m.gen !== this.gen) return;
    this.pending = false;
    const p = this.geo.getAttribute("position") as THREE.BufferAttribute | undefined;
    const v = this.geo.getAttribute("velocity") as THREE.BufferAttribute | undefined;
    if (!p || !v || m.pos.length !== p.array.length) return; // records changed meanwhile
    (p.array as Float32Array).set(m.pos);
    (v.array as Float32Array).set(m.vel);
    p.needsUpdate = v.needsUpdate = true;
    this.stateT = m.t;
    this.lastWorkerMs = m.ms;
  }

  /** World position (km) of record i at the current extrapolation time, or null if unavailable. */
  positionOf(i: number, out: THREE.Vector3): THREE.Vector3 | null {
    const p = this.geo.getAttribute("position") as THREE.BufferAttribute | undefined;
    const v = this.geo.getAttribute("velocity") as THREE.BufferAttribute | undefined;
    if (!p || !v || i < 0 || i >= this.n) return null;
    const dt = this.mat.uniforms.uDt!.value as number;
    out.set(p.getX(i) + v.getX(i) * dt, p.getY(i) + v.getY(i) * dt, p.getZ(i) + v.getZ(i) * dt);
    return out.lengthSq() > 1e6 ? out : null;
  }

  /**
   * Nearest visible satellite to a screen point (CSS pixels), within `maxPx`, not hidden behind
   * the Earth. `toRender` maps world -> render space (the root group's matrix).
   */
  pick(
    x: number,
    y: number,
    width: number,
    height: number,
    camera: THREE.Camera,
    toRender: THREE.Matrix4,
    earthCenter: THREE.Vector3,
    maxPx = 10,
  ): number {
    const vis = this.geo.getAttribute("visible") as THREE.BufferAttribute | undefined;
    if (!vis) return -1;
    let best = -1;
    let bestD = maxPx * maxPx;
    const cam = camera.position;
    for (let i = 0; i < this.n; i++) {
      if (!vis.getX(i)) continue;
      const w = this.positionOf(i, this.tmp);
      if (!w) continue;
      w.applyMatrix4(toRender);
      this.tmp2.copy(w).project(camera);
      if (this.tmp2.z > 1 || this.tmp2.z < -1) continue;
      const sx = (this.tmp2.x * 0.5 + 0.5) * width;
      const sy = (-this.tmp2.y * 0.5 + 0.5) * height;
      const d = (sx - x) ** 2 + (sy - y) ** 2;
      if (d >= bestD) continue;
      // occluded by the Earth?
      const dir = this.tmp2.copy(w).sub(cam);
      const oc = w.copy(cam).sub(earthCenter);
      const t = THREE.MathUtils.clamp(-oc.dot(dir) / dir.lengthSq(), 0, 1);
      if (oc.addScaledVector(dir, t).length() < R) continue;
      best = i;
      bestD = d;
    }
    return best;
  }

  idAt(i: number): number | undefined {
    return this.ids[i];
  }

  dispose() {
    this.worker.terminate();
    this.geo.dispose();
    this.mat.dispose();
  }
}
