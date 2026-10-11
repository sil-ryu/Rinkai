import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { lvlhQuaternion } from "./lvlh";

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const scratch = (): [THREE.Vector3, THREE.Vector3, THREE.Vector3] => [v(0, 0, 0), v(0, 0, 0), v(0, 0, 0)];

describe("LVLH attitude", () => {
  it("maps body axes to velocity, zenith and -orbit-normal", () => {
    const pos = v(6800, 0, 0);
    const vel = v(0.1, 0, 1).normalize(); // slight radial component must be removed
    const q = lvlhQuaternion(pos, vel, new THREE.Quaternion(), scratch());
    const bx = v(1, 0, 0).applyQuaternion(q);
    const by = v(0, 1, 0).applyQuaternion(q);
    const bz = v(0, 0, 1).applyQuaternion(q);
    expect(bx.distanceTo(v(0, 0, 1))).toBeLessThan(1e-9); // forward = horizontal velocity
    expect(by.distanceTo(v(1, 0, 0))).toBeLessThan(1e-9); // up = radial
    const h = v(0, 0, 0).crossVectors(pos, vel).normalize();
    expect(bz.distanceTo(h.negate())).toBeLessThan(1e-9); // starboard = -h
  });

  it("is a proper rotation (no mirroring)", () => {
    const q = lvlhQuaternion(
      v(1000, 6000, -2000),
      v(-0.3, 0.2, 0.9).normalize(),
      new THREE.Quaternion(),
      scratch(),
    );
    const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
    expect(m.determinant()).toBeCloseTo(1, 9);
  });
});
