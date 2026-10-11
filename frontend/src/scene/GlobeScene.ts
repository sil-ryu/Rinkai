import CameraControls from "camera-controls";
import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { R_EARTH_EQ_KM as R } from "../physics/constants";
import type { Vec3 } from "../physics/frames";
import { lvlhQuaternion } from "./lvlh";
import type { StationModel } from "./models/parts";
import { moonIlluminatedFraction } from "../physics/moon";
import { MoonBody } from "./sky/MoonBody";
import { StarField } from "./sky/StarField";
import { SwarmLayer, type SwarmRecord } from "./swarm/SwarmLayer";

CameraControls.install({ THREE });

/**
 * Scene units are kilometres. "World" coordinates are Earth-fixed with scene axes
 * (x, y, z) = ECEF (x, z, -y), so +y is the north pole; scaling happens only here.
 *
 * Floating origin: every world object lives under `root`. In Earth view root is the identity.
 * In a station view root maps world -> the station's LVLH frame (+x forward, +y zenith,
 * +z starboard), so the station sits still at the render origin with full float precision
 * at metre scale and the camera controls never have to chase it; Earth turns beneath it.
 */
export function ecefKmToScene(v: Vec3, out: THREE.Vector3, radius = 0): THREE.Vector3 {
  out.set(v.x, v.z, -v.y);
  if (radius > 0) out.setLength(radius);
  return out;
}

export const TRACK_POINTS = 141; // -45 .. +95 minutes at 1-minute steps
const TRACK_RADIUS = R * 1.002;
const MODEL_VISIBLE_KM = 2500; // beyond this the model is sub-pixel; show the marker only
const SUN_DISTANCE_KM = 150_000; // inside the far plane; direction is what matters
const SUN_INTENSITY = 2.8;

export type View = "earth" | string;

type StationGfx = {
  model: StationModel;
  holder: THREE.Group; // positioned and oriented (LVLH) in world coords
  marker: THREE.Mesh;
  label: CSS2DObject;
  track: THREE.Line;
  trackPos: Float32Array;
  pos: THREE.Vector3; // world km
  q: THREE.Quaternion; // LVLH attitude in world
  hasPos: boolean;
  sunlit: boolean;
};

// Custom shaders must include the logdepthbuf chunks, or depth won't match the renderer's
// logarithmic depth buffer and far-side objects draw in front of the globe.
const earthVert = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }`;

const earthFrag = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D dailyMap;
  uniform float uDaily;
  uniform vec3 sunDir;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 nrm = normalize(vNormal);
    float d = dot(nrm, sunDir);
    float dayMix = smoothstep(-0.08, 0.12, d);
    vec3 base = texture2D(dayMap, vUv).rgb;
    // Daily VIIRS mosaic (real clouds). No-data areas (polar night, swath gaps) are black: keep base there.
    vec3 daily = texture2D(dailyMap, vUv).rgb;
    float valid = uDaily * step(0.035, max(daily.r, max(daily.g, daily.b)));
    vec3 surface = mix(base, daily, valid);
    float cloud = valid * smoothstep(0.42, 0.75, min(daily.r, min(daily.g, daily.b)));
    // Sun glint on open water (water mask from the Blue Marble base), suppressed under clouds.
    float water = smoothstep(0.04, 0.14, base.b - max(base.r, base.g));
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float spec = pow(max(dot(reflect(-sunDir, nrm), viewDir), 0.0), 90.0) * water * (1.0 - cloud);
    vec3 day = surface * (0.35 + 0.65 * clamp(d * 1.4 + 0.2, 0.0, 1.0)) + vec3(1.0, 0.93, 0.8) * spec * 0.85 * dayMix;
    vec3 n = texture2D(nightMap, vUv).rgb;
    // Keep the city lights, suppress the dim blue land tone of the Black Marble base.
    vec3 night = smoothstep(0.12, 0.6, n) * vec3(1.0, 0.82, 0.55) * 1.5 + texture2D(dayMap, vUv).rgb * 0.025;
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
  private root = new THREE.Group();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.0005, 2_000_000);
  private controls: CameraControls;
  private sunUniform = { value: new THREE.Vector3(1, 0, 0) };
  private earthUniforms: {
    dayMap: { value: THREE.Texture };
    nightMap: { value: THREE.Texture };
    dailyMap: { value: THREE.Texture | null };
    uDaily: { value: number };
    sunDir: { value: THREE.Vector3 };
  };
  private sunWorld = new THREE.Vector3(1, 0, 0);
  private sunLight = new THREE.DirectionalLight(0xfff4e6, SUN_INTENSITY);
  private earthshine = new THREE.DirectionalLight(0x8fb4ff, 0);
  private ambient = new THREE.AmbientLight(0xbfd2ff, 0.12);
  private sunSprite: THREE.Sprite;
  private stations = new Map<string, StationGfx>();
  private disposables: { dispose(): void }[] = [];
  private raf = 0;
  private lastFrame = performance.now();
  private resizeObs: ResizeObserver;
  private view: View = "earth";
  private labelsOn = true;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private tmp3 = new THREE.Vector3();
  private tmp4 = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private basis = new THREE.Matrix4();

  readonly swarm: SwarmLayer;
  private stars: StarField;
  private moon = new MoonBody();
  private moonLabel: CSS2DObject;
  private selLabel: CSS2DObject;
  private selIndex = -1;
  private selOrbit: THREE.Line;
  private selOrbitPos = new Float32Array(181 * 3);
  private simDate = new Date();
  private simRate = 1;
  private lastMoonLabel = 0;
  private dailyTex: THREE.Texture | null = null;
  private dailyUrl: string | null = null;
  private disposed = false;
  private layers = { satellites: true, stars: true, clouds: true };
  private down: { x: number; y: number; t: number } | null = null;

  onFrame: () => void = () => {};
  onSelect: (id: string) => void = () => {};
  /** Click on a swarm satellite (record index), or -1 for a click on empty space. */
  onPickSat: (index: number) => void = () => {};

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; // Earth's ShaderMaterial opts out (no tonemapping chunk)
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.labels.domElement.className = "globe-labels";
    container.appendChild(this.labels.domElement);
    this.scene.add(this.root);

    // --- camera controls: smooth, no panning, same action on left and right drag ---
    this.controls = new CameraControls(this.camera, this.labels.domElement);
    const A = CameraControls.ACTION;
    this.controls.mouseButtons.left = A.ROTATE;
    this.controls.mouseButtons.right = A.ROTATE;
    this.controls.mouseButtons.middle = A.DOLLY;
    this.controls.mouseButtons.wheel = A.DOLLY;
    this.controls.touches.one = A.TOUCH_ROTATE;
    this.controls.touches.two = A.TOUCH_DOLLY;
    this.controls.touches.three = A.NONE;
    this.controls.smoothTime = 0.22;
    this.controls.draggingSmoothTime = 0.1;
    this.controls.dollySpeed = 0.6;
    this.controls.minPolarAngle = 0.02;
    this.controls.maxPolarAngle = Math.PI - 0.02;
    this.applyViewLimits();
    this.controls.setLookAt(R * 1.6, R * 1.9, R * 2.6, 0, 0, 0, false);

    // --- Earth ---
    const loader = new THREE.TextureLoader();
    const day = loader.load("/textures/earth_day.jpg");
    const night = loader.load("/textures/earth_night.jpg");
    day.colorSpace = night.colorSpace = THREE.SRGBColorSpace;
    day.anisotropy = night.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.earthUniforms = {
      dayMap: { value: day },
      nightMap: { value: night },
      dailyMap: { value: day }, // placeholder until the daily mosaic loads
      uDaily: { value: 0 },
      sunDir: this.sunUniform,
    };
    const earthGeo = new THREE.SphereGeometry(R, 192, 96);
    const earthMat = new THREE.ShaderMaterial({
      uniforms: this.earthUniforms,
      vertexShader: earthVert,
      fragmentShader: earthFrag,
    });
    this.root.add(new THREE.Mesh(earthGeo, earthMat));

    const atmoGeo = new THREE.SphereGeometry(R * 1.022, 128, 64);
    const atmoMat = new THREE.ShaderMaterial({
      uniforms: { sunDir: this.sunUniform },
      vertexShader: atmoVert,
      fragmentShader: atmoFrag,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.root.add(new THREE.Mesh(atmoGeo, atmoMat));

    // --- Sun: light + glow sprite, both in world coords under root ---
    // The sun light lives in render space next to the focused station so its shadow camera can be
    // fitted tightly around the model (a light 150,000 km away can't cast metre-scale shadows).
    const sunTarget = new THREE.Object3D();
    this.scene.add(sunTarget, this.sunLight);
    this.sunLight.target = sunTarget;
    const sh = this.sunLight.shadow;
    sh.mapSize.set(2048, 2048);
    sh.bias = -0.0002;
    sh.normalBias = 0.0002;
    this.scene.environment = spaceEnvironment(this.renderer);
    const sunMat = new THREE.SpriteMaterial({
      map: glowTexture(),
      color: 0xfff1d6,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.sunSprite = new THREE.Sprite(sunMat);
    this.sunSprite.scale.setScalar(9000);
    this.root.add(this.sunSprite);
    // Ambient keeps shadowed sides readable; earthshine lights a station from below in station view.
    this.scene.add(this.ambient, this.earthshine);
    this.earthshine.position.set(0, -1, 0);

    this.disposables.push(day, night, earthGeo, earthMat, atmoGeo, atmoMat, sunMat);

    // --- sky: stars (camera-centred sphere), Moon, satellite swarm ---
    const px = this.renderer.getPixelRatio();
    this.stars = new StarField(px);
    this.scene.add(this.stars.points);
    void this.stars.load().catch((e) => console.warn("star field unavailable", e));
    this.root.add(this.moon.mesh);
    this.moonLabel = new CSS2DObject(
      Object.assign(document.createElement("div"), { className: "sky-label" }),
    );
    this.moon.mesh.add(this.moonLabel);
    this.swarm = new SwarmLayer(px);
    this.root.add(this.swarm.points);
    const selGeo = new THREE.BufferGeometry();
    selGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(this.selOrbitPos, 3).setUsage(THREE.DynamicDrawUsage),
    );
    selGeo.setDrawRange(0, 0);
    const selMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
    this.selOrbit = new THREE.Line(selGeo, selMat);
    this.selOrbit.frustumCulled = false;
    this.root.add(this.selOrbit);
    const selEl = Object.assign(document.createElement("div"), { className: "sat-label" });
    this.selLabel = new CSS2DObject(selEl);
    this.selLabel.visible = false;
    this.root.add(this.selLabel);
    this.disposables.push(this.stars, this.moon, this.swarm, selGeo, selMat);

    // Click (not drag) picks a satellite.
    const el = this.labels.domElement;
    el.addEventListener(
      "pointerdown",
      (e) => (this.down = { x: e.clientX, y: e.clientY, t: performance.now() }),
    );
    el.addEventListener("pointerup", (e) => {
      const d = this.down;
      this.down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || performance.now() - d.t > 400) return;
      if (!this.layers.satellites) return;
      const r = el.getBoundingClientRect();
      this.root.updateMatrixWorld();
      const i = this.swarm.pick(
        e.clientX - r.left,
        e.clientY - r.top,
        r.width,
        r.height,
        this.camera,
        this.root.matrixWorld,
        this.root.position,
      );
      this.onPickSat(i);
    });

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
  }

  addStation(id: string, label: string, color: string, model: StationModel) {
    if (this.stations.has(id)) {
      model.dispose();
      return;
    }
    const holder = new THREE.Group();
    model.group.scale.setScalar(0.001); // metres -> km
    holder.add(model.group);

    const c = new THREE.Color(color);
    const markerGeo = new THREE.OctahedronGeometry(1);
    const markerMat = new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
    const marker = new THREE.Mesh(markerGeo, markerMat);
    const haloMat = new THREE.SpriteMaterial({
      map: glowTexture(),
      color: c,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const halo = new THREE.Sprite(haloMat);
    halo.scale.setScalar(6);
    marker.add(halo);
    holder.add(marker);

    const el = document.createElement("button");
    el.className = "station-label";
    el.style.setProperty("--c", color);
    el.textContent = label;
    el.addEventListener("click", () => this.onSelect(id));
    const labelObj = new CSS2DObject(el);
    holder.add(labelObj);

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

    holder.visible = false;
    this.root.add(holder, track);
    this.stations.set(id, {
      model,
      holder,
      marker,
      label: labelObj,
      track,
      trackPos,
      pos: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      hasPos: false,
      sunlit: true,
    });
    this.disposables.push(markerGeo, markerMat, haloMat, trackGeo, trackMat, model);
  }

  /** Position (ECEF km) and flight direction (unit, ECEF axes) of a station; null hides it. */
  setStationState(id: string, posEcefKm: Vec3 | null, velDirEcef: Vec3 | null) {
    const s = this.stations.get(id);
    if (!s) return;
    s.hasPos = !!posEcefKm && !!velDirEcef;
    s.holder.visible = s.hasPos;
    if (!posEcefKm || !velDirEcef) return;
    ecefKmToScene(posEcefKm, s.pos);
    lvlhQuaternion(
      s.pos,
      ecefKmToScene(velDirEcef, this.tmp2),
      s.q,
      [this.tmp, this.tmp3, this.tmp4],
      this.basis,
    );
    s.holder.position.copy(s.pos);
    s.holder.quaternion.copy(s.q);
  }

  /** Is a station currently in sunlight? (cylindrical Earth-shadow model) */
  isSunlit(id: string): boolean | null {
    const s = this.stations.get(id);
    return s?.hasPos ? s.sunlit : null;
  }

  /** Ground track points (ECEF km), drawn on the surface. */
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
    (s.track.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    s.track.geometry.setDrawRange(0, n);
    s.track.geometry.computeBoundingSphere();
  }

  /** Hide stations (marker, label, track) that are no longer in the data. */
  retainStations(ids: Set<string>) {
    for (const [id, s] of this.stations) {
      if (ids.has(id)) continue;
      s.hasPos = false;
      s.holder.visible = false;
      s.track.geometry.setDrawRange(0, 0);
    }
  }

  setTracksVisible(v: boolean) {
    for (const s of this.stations.values()) s.track.visible = v;
  }

  setLabelsVisible(v: boolean) {
    this.labelsOn = v;
  }

  /** Current simulation time and rate; drives the swarm, stars and Moon. */
  setSimTime(ms: number, rate: number) {
    this.simDate.setTime(ms);
    this.simRate = rate;
  }

  setSwarmRecords(records: SwarmRecord[]) {
    this.swarm.setRecords(records);
    this.setSelectedSat(-1, "", "#fff", null);
  }

  /** Highlight a swarm satellite and draw its orbit (ECEF km points over one period), or clear with -1. */
  setSelectedSat(index: number, name: string, color: string, orbitEcefKm: Vec3[] | null) {
    this.selIndex = index;
    this.swarm.setSelected(index);
    const el = this.selLabel.element;
    el.textContent = name;
    el.style.setProperty("--c", color);
    let n = 0;
    for (const p of orbitEcefKm ?? []) {
      if (n >= 181) break;
      this.selOrbitPos[n * 3] = p.x;
      this.selOrbitPos[n * 3 + 1] = p.z;
      this.selOrbitPos[n * 3 + 2] = -p.y;
      n++;
    }
    const g = this.selOrbit.geometry;
    (g.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    g.setDrawRange(0, index >= 0 ? n : 0);
    (this.selOrbit.material as THREE.LineBasicMaterial).color.set(color);
  }

  setLayers(layers: { satellites: boolean; stars: boolean; clouds: boolean }) {
    this.layers = { ...layers };
    this.swarm.points.visible = layers.satellites;
    this.selOrbit.visible = layers.satellites;
    this.stars.points.visible = layers.stars;
    this.earthUniforms.uDaily.value = layers.clouds && this.dailyTex ? 1 : 0;
  }

  /** Load the daily VIIRS mosaic (served by our backend) into the Earth shader. */
  setDailyImagery(url: string | null) {
    if (!url || url === this.dailyUrl) return; // same mosaic: don't re-download 2 MB
    this.dailyUrl = url;
    new THREE.TextureLoader().load(url, (t) => {
      if (this.disposed) {
        t.dispose(); // loaded after the scene was torn down (StrictMode / HMR)
        return;
      }
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      this.dailyTex?.dispose();
      this.dailyTex = t;
      this.earthUniforms.dailyMap.value = t;
      this.earthUniforms.uDaily.value = this.layers.clouds ? 1 : 0;
    });
  }

  setSunEcef(dir: Vec3) {
    ecefKmToScene(dir, this.sunWorld).normalize();
  }

  // ---------------- view / camera ----------------

  getView(): View {
    return this.view;
  }

  /** Switch between Earth view and a station view with a smooth fly-in, without a visual jump. */
  setView(view: View) {
    if (view === this.view) return;
    const st = view === "earth" ? null : this.stations.get(view);
    if (view !== "earth" && !st?.hasPos) return;

    // Camera position in world coords under the current root, then re-expressed under the new root.
    this.root.updateMatrixWorld();
    const camWorld = this.camera.position.clone().applyMatrix4(this.root.matrixWorld.clone().invert());
    this.view = view;
    this.updateRoot();
    this.root.updateMatrixWorld();
    const camRender = camWorld.clone().applyMatrix4(this.root.matrixWorld);
    this.applyViewLimits();
    this.controls.setLookAt(camRender.x, camRender.y, camRender.z, 0, 0, 0, false);

    if (st) {
      const k = st.model.spanM / 1000;
      void this.controls.setLookAt(-1.25 * k, 0.45 * k, 1.05 * k, 0, 0, 0, true);
    } else {
      const dir =
        camWorld.lengthSq() > 1 ? camWorld.normalize() : new THREE.Vector3(0.4, 0.5, 0.75).normalize();
      const p = dir.multiplyScalar(R * 3.4);
      void this.controls.setLookAt(p.x, p.y, p.z, 0, 0, 0, true);
    }
  }

  /** Keyboard helpers (radians / multiplicative zoom). */
  rotateBy(azimuth: number, polar: number) {
    void this.controls.rotate(azimuth, polar, true);
  }

  zoomBy(factor: number) {
    // Scale the transition's *end* distance so repeated key presses compound instead of
    // restarting from the current, still-animating distance.
    const end = this.controls.getSpherical(new THREE.Spherical(), true).radius;
    void this.controls.dollyTo(
      THREE.MathUtils.clamp(end * factor, this.controls.minDistance, this.controls.maxDistance),
      true,
    );
  }

  resetView() {
    if (this.view === "earth") void this.controls.setLookAt(R * 1.6, R * 1.9, R * 2.6, 0, 0, 0, true);
    else {
      const k = (this.stations.get(this.view)?.model.spanM ?? 100) / 1000;
      void this.controls.setLookAt(-1.25 * k, 0.45 * k, 1.05 * k, 0, 0, 0, true);
    }
  }

  private applyViewLimits() {
    if (this.view === "earth") {
      this.controls.minDistance = R + 300;
      this.controls.maxDistance = R * 90;
    } else {
      const k = (this.stations.get(this.view)?.model.spanM ?? 100) / 1000;
      this.controls.minDistance = k * 0.45;
      this.controls.maxDistance = R * 6;
    }
  }

  private updateRoot() {
    const st = this.view === "earth" ? null : this.stations.get(this.view);
    if (!st?.hasPos) {
      this.root.position.set(0, 0, 0);
      this.root.quaternion.identity();
      return;
    }
    // root = (T(p) * R(q))^-1 : world -> station LVLH frame
    this.root.quaternion.copy(st.q).invert();
    this.root.position.copy(st.pos).applyQuaternion(this.root.quaternion).negate();
  }

  // ---------------- frame loop ----------------

  start() {
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
      this.lastFrame = now;
      this.onFrame();
      this.updateRoot();
      this.updateSky();
      this.updateLighting();
      this.updateStationsLod();
      this.updateControlSpeed();
      this.controls.update(dt);
      this.renderer.render(this.scene, this.camera);
      this.labels.render(this.scene, this.camera);
    };
    loop();
  }

  private updateSky() {
    this.moon.update(this.simDate);
    this.stars.update(this.simDate, this.root.quaternion, this.camera.position);
    this.swarm.update(this.simDate.getTime(), this.sunWorld, this.simRate);
    // Selected satellite label follows its (extrapolated) position.
    const p = this.selIndex >= 0 ? this.swarm.positionOf(this.selIndex, this.tmp) : null;
    this.selLabel.visible = !!p && this.layers.satellites && this.labelsOn;
    if (p) this.selLabel.position.copy(p);
    // Moon label with phase, refreshed once a second
    const now = performance.now();
    if (now - this.lastMoonLabel > 1000) {
      this.lastMoonLabel = now;
      const ecef = { x: this.moon.worldPos.x, y: -this.moon.worldPos.z, z: this.moon.worldPos.y };
      const sun = { x: this.sunWorld.x, y: -this.sunWorld.z, z: this.sunWorld.y };
      const lit = Math.round(moonIlluminatedFraction(ecef, sun) * 100);
      this.moonLabel.element.textContent = `Moon · ${lit}% lit`;
    }
    this.moonLabel.visible = this.labelsOn;
    // Bright surroundings wash out faint stars: dim them in a sunlit station view.
    const focus = this.view === "earth" ? null : this.stations.get(this.view);
    this.stars.setGain(focus && focus.sunlit ? 0.55 : 1);
  }

  private updateLighting() {
    // Sun direction in render space (root rotation applied) for the Earth shader.
    this.sunUniform.value.copy(this.sunWorld).applyQuaternion(this.root.quaternion);
    this.sunSprite.position.copy(this.sunWorld).multiplyScalar(SUN_DISTANCE_KM);

    for (const s of this.stations.values()) {
      if (!s.hasPos) continue;
      // Cylindrical shadow: behind Earth relative to the Sun and within one Earth radius of the axis.
      const along = s.pos.dot(this.sunWorld);
      s.sunlit = along > 0 || this.tmp.copy(s.pos).addScaledVector(this.sunWorld, -along).length() > R;
      // Sun direction in the model's own axes, for array tracking.
      s.model.trackSun(this.tmp.copy(this.sunWorld).applyQuaternion(this.tmpQ.copy(s.q).invert()));
    }

    const focus = this.view === "earth" ? null : this.stations.get(this.view);
    const eclipsed = !!focus && !focus.sunlit;
    const span = focus ? focus.model.spanM / 1000 : 1;
    this.sunLight.position.copy(this.sunUniform.value).multiplyScalar(span * 2);
    this.sunLight.castShadow = !!focus && !eclipsed;
    if (focus) {
      const cam = this.sunLight.shadow.camera;
      const half = span * 0.7;
      if (cam.right !== half) {
        Object.assign(cam, {
          left: -half,
          right: half,
          top: half,
          bottom: -half,
          near: span * 0.5,
          far: span * 3.5,
        });
        cam.updateProjectionMatrix();
      }
    }
    this.sunLight.intensity = eclipsed ? 0 : SUN_INTENSITY;
    // Real eclipses are nearly black; a dim fill keeps the model readable (station lights, earthshine, eyes adapting).
    this.ambient.intensity = eclipsed ? 0.45 : 0.12;
    if (focus) {
      // Light reflected from the Earth below: strongest over the day side.
      const zenith = this.tmp.copy(focus.pos).normalize();
      const dayBelow = Math.max(0, zenith.dot(this.sunWorld));
      this.earthshine.intensity = 0.08 + 0.5 * dayBelow;
      // Reflections: a bright Earth below on the day side, almost nothing at night or in eclipse.
      this.scene.environmentIntensity = eclipsed ? 0.06 : 0.2 + 0.7 * dayBelow;
    } else {
      this.earthshine.intensity = 0;
      this.scene.environmentIntensity = 0.3;
    }
  }

  /** Screen-constant markers when far; true-scale models when close; label visibility. */
  private updateStationsLod() {
    const cam = this.camera.position;
    const earthCenter = this.root.position; // Earth centre in render space
    for (const [id, s] of this.stations) {
      if (!s.hasPos) {
        s.label.visible = false;
        continue;
      }
      s.holder.getWorldPosition(this.tmp);
      const dist = this.tmp.distanceTo(cam);
      const modelKm = s.model.spanM / 1000;
      s.model.group.visible = dist < MODEL_VISIBLE_KM;
      const markerOn = dist > modelKm * 25;
      s.marker.visible = markerOn;
      // marker sized to ~1% of the distance (constant on screen), in holder (km) units
      s.marker.scale.setScalar(dist * 0.0075);

      // Label: hidden when occluded by the Earth, when labels are off, or when we're right next to it.
      const d = this.tmp2.copy(this.tmp).sub(cam);
      const oc = this.tmp.copy(cam).sub(earthCenter);
      const t = THREE.MathUtils.clamp(-oc.dot(d) / d.lengthSq(), 0, 1);
      const closest = oc.addScaledVector(d, t);
      const occluded = closest.length() < R;
      const close = this.view === id && dist < modelKm * 40;
      const far = dist > 60_000; // labels would pile up on a tiny Earth
      s.label.visible = this.labelsOn && !occluded && !close && !far;
      s.label.element.classList.toggle("focused", this.view === id);
    }
  }

  /** In Earth view, slow rotation down near the surface so dragging feels like grabbing the globe. */
  private updateControlSpeed() {
    if (this.view !== "earth") {
      this.controls.azimuthRotateSpeed = this.controls.polarRotateSpeed = 0.8;
      return;
    }
    const alt = this.controls.distance - R;
    const k = THREE.MathUtils.clamp(alt / (R * 1.6), 0.04, 0.9);
    this.controls.azimuthRotateSpeed = this.controls.polarRotateSpeed = k;
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
    this.disposed = true;
    this.dailyTex?.dispose();
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

let glow: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (glow) return glow;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,0.95)");
  grad.addColorStop(0.2, "rgba(255,255,255,0.4)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glow = new THREE.CanvasTexture(c);
  return glow;
}

/**
 * Reflection environment for station materials: black space above, a bright blue-white Earth
 * below (render -y is nadir in station view). Built once with PMREM for physically based materials.
 */
function spaceEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const envScene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        float down = smoothstep(0.05, -0.35, vDir.y);
        vec3 earth = mix(vec3(0.18, 0.32, 0.55), vec3(0.75, 0.82, 0.9), smoothstep(-0.4, -0.9, vDir.y) * 0.5);
        vec3 col = mix(vec3(0.004, 0.006, 0.012), earth, down);
        col += vec3(0.25, 0.45, 0.9) * exp(-abs(vDir.y + 0.08) * 28.0) * 0.6; // atmosphere limb
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const geo = new THREE.SphereGeometry(10, 32, 16);
  envScene.add(new THREE.Mesh(geo, mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(envScene, 0, 0.1, 100).texture;
  pmrem.dispose();
  geo.dispose();
  mat.dispose();
  return tex;
}
