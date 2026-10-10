import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { R_EARTH_EQ_KM } from "../physics/constants";
import type { Vec3 } from "../physics/frames";

/**
 * Earth-fixed scene: the globe never rotates; the Sun direction and stations move.
 * Scene units are Earth equatorial radii (scaling happens only here, at render time).
 * Axes: scene (x, y, z) = ECEF (x, z, -y), so +y is the north pole.
 */
export function ecefKmToScene(v: Vec3, out: THREE.Vector3, radius = 0): THREE.Vector3 {
  out.set(v.x / R_EARTH_EQ_KM, v.z / R_EARTH_EQ_KM, -v.y / R_EARTH_EQ_KM);
  if (radius > 0) out.setLength(radius);
  return out;
}

export const TRACK_POINTS = 141; // -45 .. +95 minutes at 1-minute steps
const TRACK_RADIUS = 1.002;

type StationGfx = {
  marker: THREE.Mesh;
  halo: THREE.Sprite;
  label: CSS2DObject;
  track: THREE.Line;
  trackPos: Float32Array;
  hasPos: boolean;
};

// Custom shaders must include the logdepthbuf chunks, or depth won't match the
// renderer's logarithmic depth buffer and far-side objects draw in front of the globe.
const earthVert = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }`;

const earthFrag = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform vec3 sunDir;
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    #include <logdepthbuf_fragment>
    float d = dot(normalize(vNormal), sunDir);
    float dayMix = smoothstep(-0.08, 0.12, d);
    vec3 day = texture2D(dayMap, vUv).rgb * (0.35 + 0.65 * clamp(d * 1.4 + 0.2, 0.0, 1.0));
    vec3 night = texture2D(nightMap, vUv).rgb * vec3(1.0, 0.85, 0.6) * 1.3 + texture2D(dayMap, vUv).rgb * 0.03;
    gl_FragColor = vec4(mix(night, day, dayMix), 1.0);
    #include <colorspace_fragment>
  }`;

const atmoVert = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }`;

// Thin limb glow: a slightly larger front-facing shell, transparent except near the edge.
const atmoFrag = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform vec3 sunDir;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    #include <logdepthbuf_fragment>
    float rim = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0), 4.0);
    float lit = smoothstep(-0.25, 0.35, dot(normalize(vNormal), sunDir));
    float a = rim * (0.15 + 0.85 * lit);
    gl_FragColor = vec4(vec3(0.38, 0.62, 1.0) * a, a);
  }`;

export class GlobeScene {
  readonly renderer: THREE.WebGLRenderer;
  private labels = new CSS2DRenderer();
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
  private controls: OrbitControls;
  private earthUniforms: {
    dayMap: { value: THREE.Texture };
    nightMap: { value: THREE.Texture };
    sunDir: { value: THREE.Vector3 };
  };
  private stations = new Map<string, StationGfx>();
  private disposables: { dispose(): void }[] = [];
  private raf = 0;
  private resizeObs: ResizeObserver;
  private focusId: string | null = null;
  private follow = false;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  onFrame: (now: Date) => void = () => {};
  onUserMove: () => void = () => {};
  onSelect: (id: string) => void = () => {};

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.labels.domElement.className = "globe-labels";
    container.appendChild(this.labels.domElement);

    this.camera.position.set(0.8, 1.2, 3.6);
    this.controls = new OrbitControls(this.camera, this.labels.domElement);
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.08,
      minDistance: 1.25,
      maxDistance: 12,
    });
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.5;
    this.controls.addEventListener("start", () => this.onUserMove());

    const loader = new THREE.TextureLoader();
    const day = loader.load("/textures/earth_day.jpg");
    const night = loader.load("/textures/earth_night.jpg");
    day.colorSpace = night.colorSpace = THREE.SRGBColorSpace;
    day.anisotropy = night.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.earthUniforms = {
      dayMap: { value: day },
      nightMap: { value: night },
      sunDir: { value: new THREE.Vector3(1, 0, 0) },
    };

    const earthGeo = new THREE.SphereGeometry(1, 128, 64);
    const earthMat = new THREE.ShaderMaterial({
      uniforms: this.earthUniforms,
      vertexShader: earthVert,
      fragmentShader: earthFrag,
    });
    this.scene.add(new THREE.Mesh(earthGeo, earthMat));

    const atmoGeo = new THREE.SphereGeometry(1.022, 96, 48);
    const atmoMat = new THREE.ShaderMaterial({
      uniforms: { sunDir: this.earthUniforms.sunDir },
      vertexShader: atmoVert,
      fragmentShader: atmoFrag,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(atmoGeo, atmoMat));

    this.disposables.push(day, night, earthGeo, earthMat, atmoGeo, atmoMat);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
  }

  addStation(id: string, label: string, color: string) {
    if (this.stations.has(id)) return;
    const c = new THREE.Color(color);
    const markerGeo = new THREE.OctahedronGeometry(0.014);
    const markerMat = new THREE.MeshBasicMaterial({ color: c });
    const marker = new THREE.Mesh(markerGeo, markerMat);

    const haloMat = new THREE.SpriteMaterial({
      map: haloTexture(),
      color: c,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const halo = new THREE.Sprite(haloMat);
    halo.scale.setScalar(0.09);
    marker.add(halo);

    const el = document.createElement("button");
    el.className = "station-label";
    el.style.setProperty("--c", color);
    el.textContent = label;
    el.addEventListener("click", () => this.onSelect(id));
    const labelObj = new CSS2DObject(el);
    labelObj.position.set(0, 0.04, 0);
    marker.add(labelObj);

    const trackPos = new Float32Array(TRACK_POINTS * 3);
    const trackCol = new Float32Array(TRACK_POINTS * 3);
    for (let i = 0; i < TRACK_POINTS; i++) {
      const fade = i < 45 ? 0.25 + (0.35 * i) / 45 : 1 - (0.6 * (i - 45)) / (TRACK_POINTS - 45);
      trackCol.set([c.r * fade, c.g * fade, c.b * fade], i * 3);
    }
    const trackGeo = new THREE.BufferGeometry();
    trackGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(trackPos, 3).setUsage(THREE.DynamicDrawUsage),
    );
    trackGeo.setAttribute("color", new THREE.BufferAttribute(trackCol, 3));
    trackGeo.setDrawRange(0, 0);
    const trackMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 });
    const track = new THREE.Line(trackGeo, trackMat);

    marker.visible = false;
    this.scene.add(marker, track);
    this.stations.set(id, { marker, halo, label: labelObj, track, trackPos, hasPos: false });
    this.disposables.push(markerGeo, markerMat, haloMat, trackGeo, trackMat);
  }

  setStationPosition(id: string, posEcefKm: Vec3 | null) {
    const s = this.stations.get(id);
    if (!s) return;
    s.hasPos = !!posEcefKm;
    s.marker.visible = s.hasPos;
    s.label.visible = s.hasPos;
    if (posEcefKm) ecefKmToScene(posEcefKm, s.marker.position);
  }

  /** Ground track points (ECEF km), drawn on the surface. `count` <= TRACK_POINTS. */
  setTrack(id: string, pointsEcefKm: (Vec3 | null)[]) {
    const s = this.stations.get(id);
    if (!s) return;
    let n = 0;
    for (const p of pointsEcefKm) {
      if (!p || n >= TRACK_POINTS) continue;
      ecefKmToScene(p, this.tmp, TRACK_RADIUS);
      s.trackPos[n * 3] = this.tmp.x;
      s.trackPos[n * 3 + 1] = this.tmp.y;
      s.trackPos[n * 3 + 2] = this.tmp.z;
      n++;
    }
    const attr = s.track.geometry.getAttribute("position") as THREE.BufferAttribute;
    attr.needsUpdate = true;
    s.track.geometry.setDrawRange(0, n);
    s.track.geometry.computeBoundingSphere();
  }

  /** Hide stations (marker, label, track) that are no longer in the data. */
  retainStations(ids: Set<string>) {
    for (const [id, s] of this.stations) {
      if (ids.has(id)) continue;
      this.setStationPosition(id, null);
      s.track.geometry.setDrawRange(0, 0);
    }
  }

  setTracksVisible(v: boolean) {
    for (const s of this.stations.values()) s.track.visible = v;
  }

  setSunEcef(dir: Vec3) {
    ecefKmToScene(dir, this.earthUniforms.sunDir.value).normalize();
  }

  setFocus(id: string | null, follow: boolean) {
    this.focusId = id;
    this.follow = follow;
    for (const [sid, s] of this.stations) s.label.element.classList.toggle("focused", sid === id);
  }

  start() {
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.onFrame(new Date());
      this.updateCamera();
      this.updateLabelOcclusion();
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.labels.render(this.scene, this.camera);
    };
    loop();
  }

  /** HTML labels ignore the depth buffer, so hide those whose line of sight passes through the Earth. */
  private updateLabelOcclusion() {
    const cam = this.camera.position;
    for (const s of this.stations.values()) {
      if (!s.hasPos) continue;
      const d = this.tmp.copy(s.marker.position).sub(cam);
      const t = Math.min(Math.max(-cam.dot(d) / d.lengthSq(), 0), 1);
      const closest = this.tmp2.copy(cam).addScaledVector(d, t);
      s.label.visible = closest.lengthSq() >= 1;
    }
  }

  private updateCamera() {
    if (!this.follow || !this.focusId) return;
    const s = this.stations.get(this.focusId);
    if (!s?.hasPos) return;
    const dist = Math.max(this.camera.position.length(), 1.6);
    this.tmp2.copy(s.marker.position).setLength(dist);
    this.camera.position.lerp(this.tmp2, 0.06).setLength(dist);
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.controls.dispose();
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    // Release the WebGL context now; StrictMode/HMR remounts would otherwise accumulate contexts.
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }
}

let halo: THREE.Texture | null = null;
function haloTexture(): THREE.Texture {
  if (halo) return halo;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  halo = new THREE.CanvasTexture(c);
  return halo;
}
