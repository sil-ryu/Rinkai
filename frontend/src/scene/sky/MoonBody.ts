import * as THREE from "three";
import { inertialOfDateToEcefKm } from "../../physics/frames";
import { moonPositionInertial } from "../../physics/moon";

const MOON_RADIUS_KM = 1737.4;

/**
 * The Moon at its true geocentric position (low-precision ephemeris, ~0.3 deg), tidally locked so
 * the near side faces Earth. Lit by the scene's sun light, so its phase is physically correct.
 * Texture: Clementine global mosaic (Naval Research Laboratory, public domain).
 */
export class MoonBody {
  readonly mesh: THREE.Mesh;
  private geo: THREE.SphereGeometry;
  private mat: THREE.MeshStandardMaterial;
  private tex: THREE.Texture;
  private m = new THREE.Matrix4();
  private origin = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  readonly worldPos = new THREE.Vector3();
  private lastMs = Number.NaN;

  constructor() {
    this.geo = new THREE.SphereGeometry(MOON_RADIUS_KM, 96, 48);
    // SphereGeometry puts texture longitude 0 at +x; rotate it to +z, which lookAt points at Earth.
    this.geo.rotateY(-Math.PI / 2);
    this.tex = new THREE.TextureLoader().load("/textures/moon.jpg");
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.MeshStandardMaterial({
      map: this.tex,
      roughness: 1,
      metalness: 0,
      envMapIntensity: 0,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
  }

  /** Place for `date` in world (Earth-fixed scene) coordinates. */
  update(date: Date) {
    // The Moon moves ~1 km/s: recompute when sim time moved >= 0.5 s (always, at high time warp).
    if (Math.abs(date.getTime() - this.lastMs) < 500) return;
    this.lastMs = date.getTime();
    const e = inertialOfDateToEcefKm(moonPositionInertial(date), date);
    this.worldPos.set(e.x, e.z, -e.y);
    this.mesh.position.copy(this.worldPos);
    this.m.lookAt(this.origin, this.worldPos, this.up); // +z towards Earth
    this.mesh.quaternion.setFromRotationMatrix(this.m);
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}
