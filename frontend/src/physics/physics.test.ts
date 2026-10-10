import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sgp4, twoline2satrec, type OMMJsonObject } from "satellite.js";
import { describe, expect, it } from "vitest";
import { GM_EARTH, GM_SUN, AU, R_EARTH_EQ_KM } from "./constants";
import { j2000ToMeanOfDate, separationKm, normalizeLonDeg } from "./frames";
import { orbitalPeriod, solveKepler, trueAnomalyFromEccentric } from "./kepler";
import { interpolateOem, oemStateAt, type OemState } from "./oem";
import { elementAgeHours, propagateSat, satrecFromOmm } from "./sgp4";
import { subsolarPoint } from "./sun";

const SNAP = resolve(__dirname, "../../../data/snapshots");
const stations: OMMJsonObject[] = JSON.parse(
  readFileSync(`${SNAP}/celestrak_stations/stations.json`, "utf8"),
);
const iss = stations.find((s) => Number(s.NORAD_CAT_ID) === 25544)!;
const tiangong = stations.find((s) => Number(s.NORAD_CAT_ID) === 48274)!;
const witi = JSON.parse(readFileSync(`${SNAP}/wheretheiss/iss.json`, "utf8"));

// Minimal OEM data-line reader for tests (the real parser lives in the backend).
const oemStates: OemState[] = readFileSync(`${SNAP}/iss_oem/ISS.OEM_J2K_EPH.txt`, "utf8")
  .split(/\r?\n/)
  .filter((l) => /^\d{4}-\d\d-\d\dT/.test(l))
  .map((l) => {
    const [t, ...n] = l.trim().split(/\s+/);
    return [Date.parse(t + "Z") / 1000, ...n.map(Number)] as OemState;
  });

describe("Kepler solver", () => {
  it("returns E = M for circular orbits", () => {
    expect(solveKepler(1.234, 0)).toBeCloseTo(1.234, 12);
  });

  it("satisfies Kepler's equation across eccentricities and anomalies", () => {
    for (const e of [0.01, 0.3, 0.7, 0.9, 0.99, 0.999]) {
      for (let M = -Math.PI; M <= Math.PI; M += 0.37) {
        const E = solveKepler(M, e);
        expect(E - e * Math.sin(E) - M).toBeCloseTo(0, 10);
      }
    }
  });

  it("rejects parabolic and hyperbolic orbits explicitly", () => {
    expect(() => solveKepler(1, 1)).toThrow(RangeError);
    expect(() => solveKepler(1, 1.5)).toThrow(RangeError);
    expect(() => solveKepler(1, -0.1)).toThrow(RangeError);
  });

  it("true anomaly is 0 at periapsis and pi at apoapsis", () => {
    expect(trueAnomalyFromEccentric(0, 0.5)).toBeCloseTo(0, 12);
    expect(Math.abs(trueAnomalyFromEccentric(Math.PI, 0.5))).toBeCloseTo(Math.PI, 12);
  });

  it("Earth's orbital period from GM_sun and 1 AU is ~365.25 days", () => {
    expect(orbitalPeriod(AU, GM_SUN) / 86400).toBeCloseTo(365.25, 0);
  });
});

describe("SGP4 stations (CelesTrak snapshot)", () => {
  it("has both ISS and Tiangong", () => {
    expect(iss.OBJECT_NAME).toBe("ISS (ZARYA)");
    expect(tiangong.OBJECT_NAME).toBe("CSS (TIANHE)");
  });

  it("propagates to plausible LEO states", () => {
    for (const omm of [iss, tiangong]) {
      const s = propagateSat(satrecFromOmm(omm), new Date(Date.parse(omm.EPOCH + "Z") + 3600e3))!;
      expect(s).not.toBeNull();
      expect(s.altKm).toBeGreaterThan(330);
      expect(s.altKm).toBeLessThan(460);
      expect(s.speedKmS).toBeGreaterThan(7.5);
      expect(s.speedKmS).toBeLessThan(7.8);
      expect(Math.abs(s.latDeg)).toBeLessThanOrEqual(Number(omm.INCLINATION) + 0.5);
    }
  });

  it("ISS period from mean motion matches the vis-viva period at that semi-major axis", () => {
    const periodMin = 1440 / Number(iss.MEAN_MOTION);
    const a = Math.cbrt(GM_EARTH * ((periodMin * 60) / (2 * Math.PI)) ** 2);
    expect(periodMin).toBeGreaterThan(92);
    expect(periodMin).toBeLessThan(93.5);
    expect(a / 1000 - R_EARTH_EQ_KM).toBeGreaterThan(380); // mean altitude-ish
  });
});

describe("ISS OEM interpolation", () => {
  it("reproduces sample points exactly", () => {
    const s = oemStates[500]!;
    const r = interpolateOem(oemStates, s[0])!;
    expect(r.pos.x).toBeCloseTo(s[1], 6);
    expect(r.vel.z).toBeCloseTo(s[6], 9);
  });

  it("leave-one-out error is tiny (8-point Lagrange)", () => {
    // Regular samples plus every sample next to an uneven gap (traffic-event nodes).
    const uneven = oemStates.flatMap((s, i) =>
      i > 4 && i < oemStates.length - 5 && Math.round(s[0] - oemStates[i - 1]![0]) !== 240 ? [i - 1, i] : [],
    );
    expect(uneven.length).toBeGreaterThan(0);
    for (const k of [100, 1000, 2000, 3000, ...uneven]) {
      const held = oemStates[k]!;
      const without = [...oemStates.slice(0, k), ...oemStates.slice(k + 1)];
      const r = interpolateOem(without, held[0])!;
      const errKm = Math.hypot(r.pos.x - held[1], r.pos.y - held[2], r.pos.z - held[3]);
      expect(errKm).toBeLessThan(0.05);
    }
  });

  it("returns null outside the ephemeris span", () => {
    expect(interpolateOem(oemStates, oemStates[0]![0] - 1)).toBeNull();
    expect(interpolateOem(oemStates, oemStates.at(-1)![0] + 1)).toBeNull();
  });
});

describe("frames and sun", () => {
  it("precession is identity at J2000 and moves the equinox by the classic rates", () => {
    const v = { x: 1, y: 0, z: 0 };
    const at2000 = j2000ToMeanOfDate(v, new Date("2000-01-01T12:00:00Z"));
    expect(at2000.x).toBeCloseTo(1, 9);
    // Independent check with the textbook annual rates m = 46.124"/yr (RA) and n = 20.043"/yr (Dec):
    // the J2000 vernal-equinox direction (RA 0, Dec 0) in mean-of-date coordinates has
    // RA = m*t and Dec = n*t. This catches a transposed matrix (opposite signs), unlike an angle check.
    const at2026 = j2000ToMeanOfDate(v, new Date("2026-10-10T00:00:00Z"));
    const years =
      (Date.parse("2026-10-10T00:00:00Z") - Date.parse("2000-01-01T12:00:00Z")) / (365.25 * 86400e3);
    const raDeg = (Math.atan2(at2026.y, at2026.x) * 180) / Math.PI;
    const decDeg = (Math.asin(at2026.z) * 180) / Math.PI;
    expect(raDeg).toBeCloseTo((46.124 * years) / 3600, 3);
    expect(decDeg).toBeCloseTo((20.043 * years) / 3600, 3);
  });

  it("subsolar point: solstice latitude and noon longitude", () => {
    expect(subsolarPoint(new Date("2026-06-21T12:00:00Z")).latDeg).toBeCloseTo(23.44, 0);
    expect(subsolarPoint(new Date("2026-12-21T12:00:00Z")).latDeg).toBeCloseTo(-23.44, 0);
    // Mid-April the equation of time is ~0, so at 12:00 UTC the subsolar longitude is ~0
    expect(Math.abs(subsolarPoint(new Date("2026-04-15T12:00:00Z")).lonDeg)).toBeLessThan(0.5);
  });

  it("normalizes longitudes", () => {
    expect(normalizeLonDeg(190)).toBeCloseTo(-170);
    expect(normalizeLonDeg(-540)).toBeCloseTo(-180);
  });
});

describe("ISS three-way cross-check (snapshots, at the wheretheiss.at timestamp)", () => {
  const at = new Date(witi.timestamp * 1000);
  const fromApi = { latDeg: witi.latitude, lonDeg: normalizeLonDeg(witi.longitude), altKm: witi.altitude };
  const fromSgp4 = propagateSat(satrecFromOmm(iss), at)!;
  const fromOem = oemStateAt([{ meta: {}, states: oemStates }], at)!;

  it("elements are recent enough for a fair comparison", () => {
    expect(elementAgeHours(iss, at)).toBeLessThan(48);
  });

  it("SGP4, NASA OEM and wheretheiss.at agree within 20 km", () => {
    const d1 = separationKm(fromSgp4, fromApi);
    const d2 = separationKm(fromOem, fromApi);
    const d3 = separationKm(fromOem, fromSgp4);
    console.info(
      `ISS deltas km: sgp4-api ${d1.toFixed(1)}, oem-api ${d2.toFixed(1)}, oem-sgp4 ${d3.toFixed(1)}`,
    );
    // 20 km: tight enough that a missing precession step (~32 km) or a transposed matrix (~64 km) fails.
    expect(d1).toBeLessThan(20);
    expect(d2).toBeLessThan(20);
    expect(d3).toBeLessThan(20);
  });
});

describe("SGP4 reference case (Vallado et al. 2006, 'Revisiting Spacetrack Report #3', sat 00005)", () => {
  // Expected TEME position/velocity (km, km/s) from the published verification output (tcppver.out).
  const L1 = "1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753";
  const L2 = "2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667";
  const cases = [
    { tsince: 0, r: [7022.46529266, -1400.08296755, 0.03995155], v: [1.893841015, 6.405893759, 4.53480725] },
    {
      tsince: 360,
      r: [-7154.03120202, -3783.17682504, -3536.19412294],
      v: [4.741887409, -4.151817765, -2.093935425],
    },
  ];
  for (const c of cases) {
    it(`matches the reference state at t = ${c.tsince} min`, () => {
      const pv = sgp4(twoline2satrec(L1, L2), c.tsince);
      if (!pv) throw new Error("propagation failed");
      const r = pv.position as { x: number; y: number; z: number };
      const v = pv.velocity as { x: number; y: number; z: number };
      expect(Math.hypot(r.x - c.r[0]!, r.y - c.r[1]!, r.z - c.r[2]!)).toBeLessThan(1e-3); // < 1 m
      expect(Math.hypot(v.x - c.v[0]!, v.y - c.v[1]!, v.z - c.v[2]!)).toBeLessThan(1e-6);
    });
  }
});
