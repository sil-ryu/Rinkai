import * as THREE from "three";
import { gmst, j2000ToMeanOfDate, type Vec3 } from "../../physics/frames";

/**
 * Real star field (Yale Bright Star Catalogue + Gaia DR3, built by backend app.starcat).
 * Stars are a sky sphere centred on the camera (no parallax), oriented from J2000 to the
 * Earth-fixed frame with precession and Earth rotation, then into render space via the root group.
 */
const RADIUS_KM = 1_500_000; // inside the camera far plane, beyond the Moon

const vert = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 color;
  attribute float mag;
  uniform float uPx;
  uniform float uGain;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float b = pow(10.0, -0.4 * (mag - 1.0)); // brightness relative to a magnitude-1 star
    gl_PointSize = clamp(1.1 + 2.6 * sqrt(b), 1.0, 7.0) * uPx;
    vAlpha = clamp(0.18 + 0.9 * b, 0.06, 1.0) * uGain;
    vColor = color;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }`;

const frag = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    #include <logdepthbuf_fragment>
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor * (0.6 + 0.4 * core), vAlpha * core);
  }`;

/** Approximate blackbody colour for a B-V colour index (Ballesteros 2012 temperature + Helland RGB fit). */
export function bvToRgb(bv: number): [number, number, number] {
  const t = (4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62))) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g =
    t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (x: number) => Math.min(255, Math.max(0, x)) / 255;
  return [c(r), c(g), c(b)];
}

/**
 * Rotation taking a J2000 direction in scene axes to the Earth-fixed scene frame at `date`
 * (IAU-76 precession, then Earth rotation by GMST). Scene (X, Y, Z) = equatorial (x, z, -y).
 */
export function j2000SceneToEcefScene(date: Date, out: THREE.Matrix4): THREE.Matrix4 {
  const g = gmst(date);
  const c = Math.cos(g);
  const s = Math.sin(g);
  const col = (sx: number, sy: number, sz: number): Vec3 => {
    const eci = j2000ToMeanOfDate({ x: sx, y: -sz, z: sy }, date);
    const ex = c * eci.x + s * eci.y; // inertial -> Earth-fixed
    const ey = -s * eci.x + c * eci.y;
    return { x: ex, y: eci.z, z: -ey }; // back to scene axes
  };
  const a = col(1, 0, 0);
  const b = col(0, 1, 0);
  const d = col(0, 0, 1);
  return out.set(a.x, b.x, d.x, 0, a.y, b.y, d.y, 0, a.z, b.z, d.z, 0, 0, 0, 0, 1);
}

export class StarField {
  readonly points: THREE.Points;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private lastOrientMs = Number.NaN;
  count = 0;
  attribution = "";

  constructor(pixelRatio: number) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uPx: { value: pixelRatio }, uGain: { value: 1 } },
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = -10;
  }

  async load(url = "/data/stars.bin", metaUrl = "/data/stars.json") {
    const ok = (r: Response) => {
      if (!r.ok) throw new Error(`${r.url}: HTTP ${r.status}`);
      return r;
    };
    const [bin, meta] = await Promise.all([
      fetch(url)
        .then(ok)
        .then((r) => r.arrayBuffer()),
      fetch(metaUrl)
        .then(ok)
        .then((r) => r.json()),
    ]);
    if (bin.byteLength % 20 !== 0) throw new Error("stars.bin has an unexpected size");
    const rec = new Float32Array(bin);
    const n = rec.length / 5;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const mag = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = rec[i * 5]! * RADIUS_KM;
      pos[i * 3 + 1] = rec[i * 5 + 1]! * RADIUS_KM;
      pos[i * 3 + 2] = rec[i * 5 + 2]! * RADIUS_KM;
      mag[i] = rec[i * 5 + 3]!;
      col.set(bvToRgb(rec[i * 5 + 4]!), i * 3);
    }
    this.geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.geo.setAttribute("mag", new THREE.BufferAttribute(mag, 1));
    this.count = n;
    this.attribution = meta.attribution ?? "";
  }

  setGain(g: number) {
    this.mat.uniforms.uGain!.value = g;
  }

  /**
   * Orient for `date`: J2000 (scene axes) -> precessed -> Earth-fixed, then into render space with
   * `rootQuat`; keep the sphere centred on the camera.
   */
  update(date: Date, rootQuat: THREE.Quaternion, cameraPos: THREE.Vector3) {
    // The sky turns 0.004 deg per second of sim time: re-derive the orientation only when sim time
    // has moved by >= 0.5 s (every frame at high time warp), and just recompose otherwise.
    if (!(Math.abs(date.getTime() - this.lastOrientMs) < 500)) {
      this.lastOrientMs = date.getTime();
      j2000SceneToEcefScene(date, this.m);
      this.q.setFromRotationMatrix(this.m);
    }
    this.points.quaternion.copy(rootQuat).multiply(this.q);
    this.points.position.copy(cameraPos);
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}
