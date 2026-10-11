import { describe, expect, it } from "vitest";
import { moonIlluminatedFraction, moonPositionInertial } from "./moon";
import { sunDirectionInertial } from "./sun";

const AU_KM = 149_597_870.7;

// Reference: JPL Horizons, target 301 (Moon), geocentric (500@399), apparent RA/Dec of date and
// range, queried 2026-10-11.
const HORIZONS = [
  { t: "2026-10-11T00:00:00Z", raDeg: 198.56909, decDeg: -12.26743, rangeAu: 0.00259992654474 },
  { t: "2027-03-01T12:00:00Z", raDeg: 264.09508, decDeg: -27.6843, rangeAu: 0.00269641890889 },
];

describe("Moon low-precision ephemeris vs JPL Horizons", () => {
  for (const h of HORIZONS) {
    it(`matches direction within 0.3 deg and range within 0.5% at ${h.t}`, () => {
      const m = moonPositionInertial(new Date(h.t));
      const r = Math.hypot(m.x, m.y, m.z);
      const ra = ((Math.atan2(m.y, m.x) * 180) / Math.PI + 360) % 360;
      const dec = (Math.asin(m.z / r) * 180) / Math.PI;
      const dRa = (((ra - h.raDeg + 540) % 360) - 180) * Math.cos((h.decDeg * Math.PI) / 180);
      expect(Math.hypot(dRa, dec - h.decDeg)).toBeLessThan(0.3);
      expect(Math.abs(r / (h.rangeAu * AU_KM) - 1)).toBeLessThan(0.005);
    });
  }

  it("illuminated fraction: Moon opposite the Sun is full, aligned is new", () => {
    const sun = { x: 1, y: 0, z: 0 };
    expect(moonIlluminatedFraction({ x: -384000, y: 0, z: 0 }, sun)).toBeCloseTo(1, 9);
    expect(moonIlluminatedFraction({ x: 384000, y: 0, z: 0 }, sun)).toBeCloseTo(0, 9);
  });

  it("phase on 2026-10-11 00:00 UTC is a thin waxing crescent (new moon was 10-10 ~15:50 UTC)", () => {
    const d = new Date("2026-10-11T00:00:00Z");
    const f = moonIlluminatedFraction(moonPositionInertial(d), sunDirectionInertial(d));
    expect(f).toBeLessThan(0.15);
  });
});
