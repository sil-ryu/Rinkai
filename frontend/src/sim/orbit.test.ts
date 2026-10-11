import { describe, expect, it } from "vitest";
import { circularOrbit, elements, MU_EARTH, predict, R_EARTH, rk4, stepSize, type State } from "./orbit";

const propagate = (s: State, seconds: number, j2 = true) => {
  let st = s;
  let t = 0;
  while (t < seconds) {
    const dt = Math.min(stepSize(st.r, null), seconds - t);
    st = rk4(st, dt, null, [0, 0, 0], { j2, moon: false, sun: false });
    t += dt;
  }
  return st;
};

describe("orbit propagation", () => {
  it("conserves two-body energy to 1e-9 over ten LEO orbits", () => {
    const s0 = circularOrbit(400, 51.6);
    const e0 = elements(s0);
    const s1 = propagate(s0, 10 * e0.periodS!, false);
    expect(Math.abs((elements(s1).energy - e0.energy) / e0.energy)).toBeLessThan(1e-9);
  });

  it("circular orbit elements: e ~ 0, period from Kepler's third law, altitudes", () => {
    const el = elements(circularOrbit(400, 51.6));
    expect(el.e).toBeLessThan(1e-12);
    expect(el.incDeg).toBeCloseTo(51.6, 9);
    expect(el.periodS! / 60).toBeCloseTo((2 * Math.PI * Math.sqrt((R_EARTH + 400) ** 3 / MU_EARTH)) / 60, 9);
    expect(el.periAltKm).toBeCloseTo(400, 6);
    expect(el.apoAltKm!).toBeCloseTo(400, 6);
  });

  it("J2 regresses the ISS orbit's node by about 5 deg/day (textbook value)", () => {
    const s0 = circularOrbit(420, 51.6);
    const s1 = propagate(s0, 86400);
    const node = (s: State) => {
      const [x, y, z] = s.r;
      const [vx, vy, vz] = s.v;
      const h = [y * vz - z * vy, z * vx - x * vz, x * vy - y * vx];
      return (Math.atan2(h[0]!, -h[1]!) * 180) / Math.PI; // RAAN from the angular momentum vector
    };
    const drift = node(s1) - node(s0);
    // dΩ/dt = -1.5 n J2 (Re/a)^2 cos i  ->  about -5.0 deg/day at 420 km, 51.6 deg
    expect(drift).toBeLessThan(-4.7);
    expect(drift).toBeGreaterThan(-5.3);
  });

  it("a prograde burn of ~3.1 km/s from LEO reaches lunar distance (TLI)", () => {
    const s0 = circularOrbit(300, 28.5);
    const vn = Math.hypot(...s0.v);
    const s1: State = { r: s0.r, v: s0.v.map((c) => (c / vn) * (vn + 3.13)) as State["v"] };
    const el = elements(s1);
    expect(el.apoAltKm!).toBeGreaterThan(350_000);
  });

  it("predicts impact for a suborbital trajectory", () => {
    const s0 = circularOrbit(200, 0);
    const slow: State = { r: s0.r, v: s0.v.map((c) => c * 0.9) as State["v"] };
    const p = predict(slow, Date.parse("2026-10-11T00:00:00Z"), 6000);
    expect(p.impact).toBe("earth");
    expect(elements(slow).periAltKm).toBeLessThan(0);
  });
});
