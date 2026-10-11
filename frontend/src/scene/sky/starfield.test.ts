import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { gmst } from "../../physics/frames";
import { bvToRgb, j2000SceneToEcefScene } from "./StarField";

const sceneDir = (raDeg: number, decDeg: number) => {
  const a = (raDeg * Math.PI) / 180;
  const d = (decDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(d) * Math.cos(a), Math.sin(d), -Math.cos(d) * Math.sin(a));
};

describe("star field orientation", () => {
  const date = new Date("2026-10-11T03:00:00Z");
  const m = j2000SceneToEcefScene(date, new THREE.Matrix4());

  it("is a proper rotation", () => {
    expect(m.determinant()).toBeCloseTo(1, 9);
  });

  it("puts Polaris (J2000 RA 37.95, Dec +89.26) within 1 deg of the north pole (scene +Y)", () => {
    const p = sceneDir(37.95, 89.264).applyMatrix4(m);
    expect((Math.acos(p.y) * 180) / Math.PI).toBeLessThan(1.0);
  });

  it("a star on the local meridian of Greenwich (RA = GMST) lands near longitude 0", () => {
    const raDeg = (gmst(date) * 180) / Math.PI;
    const p = sceneDir(raDeg, 0).applyMatrix4(m); // precession shifts it by ~0.36 deg
    const lonDeg = (Math.atan2(-p.z, p.x) * 180) / Math.PI;
    expect(Math.abs(lonDeg)).toBeLessThan(0.6);
  });

  it("colours: hot stars blue-white, cool stars orange", () => {
    const [r1, , b1] = bvToRgb(-0.2);
    const [r2, , b2] = bvToRgb(1.6);
    expect(b1).toBeGreaterThanOrEqual(r1);
    expect(r2).toBeGreaterThan(b2);
  });
});
