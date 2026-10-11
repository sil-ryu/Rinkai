import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { circularOrbit, elements, rk4, stepSize, type State } from "./orbit";
import { NO_INPUT, Ship } from "./ship";

const T0 = Date.parse("2026-10-11T00:00:00Z");
const run = (ship: Ship, seconds: number, input = NO_INPUT, frame = 0.05) => {
  const events = [];
  for (let t = 0; t < seconds; t += frame) events.push(...ship.step(T0 + t * 1000, frame, input));
  return events;
};
const nose = (s: Ship) => new THREE.Vector3(1, 0, 0).applyQuaternion(s.q);

describe("ship flight", () => {
  it("a prograde burn raises apoapsis and adds the expected delta-v", () => {
    const ship = new Ship(circularOrbit(400, 51.6));
    const before = elements({ r: ship.r, v: ship.v });
    ship.throttle = 1; // 60 kN on 18 t = 3.33 m/s^2
    run(ship, 30);
    const after = elements({ r: ship.r, v: ship.v });
    expect(ship.dvUsedKms).toBeCloseTo(((60_000 / 18_000) * 30) / 1000, 4);
    expect(after.apoAltKm! - before.apoAltKm!).toBeGreaterThan(150); // ~0.1 km/s raises apo ~ 180 km
  });

  it("SAS hold turns the nose to retrograde within half a minute", () => {
    const ship = new Ship(circularOrbit(400, 51.6)); // starts prograde
    ship.sas = "retrograde";
    run(ship, 30);
    const v = new THREE.Vector3(...ship.v).normalize();
    expect(nose(ship).angleTo(v.negate())).toBeLessThan(0.02);
  });

  it("finite fuel follows the rocket equation and cuts the engine when empty", () => {
    const ship = new Ship(circularOrbit(400, 0));
    ship.infiniteFuel = false;
    ship.fuelKg = 100;
    ship.throttle = 1;
    run(ship, 60, NO_INPUT, 0.1);
    expect(ship.fuelKg).toBe(0);
    expect(ship.throttle).toBe(0);
    const ideal = (320 * 9.80665 * Math.log(9_100 / 9_000)) / 1000;
    expect(Math.abs(ship.dvUsedKms - ideal) / ideal).toBeLessThan(0.02);
  });

  it("relative integration stays co-located with a target flying the same orbit", () => {
    // Target propagated with the same dynamics; ship starts 200 m behind with equal velocity.
    const start = circularOrbit(420, 51.6);
    const cache = new Map<number, State>();
    const target = (tMs: number): State => {
      const key = Math.round(tMs);
      if (cache.has(key)) return cache.get(key)!;
      let s = start;
      let t = 0;
      const total = (tMs - T0) / 1000;
      while (t < total - 1e-9) {
        const h = Math.min(stepSize(s.r, null), total - t);
        s = rk4(s, h, null);
        t += h;
      }
      cache.set(key, s);
      return s;
    };
    const ship = new Ship(start);
    ship.setTarget("TEST", target, T0);
    const rel0 = ship.relative(T0)!.rel.r;
    expect(Math.hypot(...rel0)).toBeLessThan(1e-9);
    for (let t = 0; t < 600; t += 10)
      ship.step(T0 + t * 1000, 10, NO_INPUT, { moon: [4e5, 0, 0], sun: [1.5e8, 0, 0] });
    expect(Math.hypot(...ship.relative(T0 + 600_000)!.rel.r)).toBeLessThan(0.001); // < 1 m after 10 min
  });

  it("docks when slow and close, and undocks on thrust", () => {
    const start = circularOrbit(420, 51.6);
    const ship = new Ship(start);
    // A target that sits 20 m ahead of wherever the ship started, moving with the same velocity.
    const fixed = (): State => ({ r: [start.r[0], start.r[1] + 0.02, start.r[2]], v: start.v });
    ship.setTarget("STATION", fixed, T0);
    ship.r = [start.r[0], start.r[1], start.r[2]];
    const ev = ship.step(T0, 0.1, NO_INPUT);
    expect(ev).toContain("docked");
    expect(ship.status).toBe("docked");
    ship.throttle = 0.1;
    expect(ship.step(T0 + 100, 0.1, NO_INPUT)).toContain("undocked");
  });

  it("detects impact with the Earth", () => {
    const s = circularOrbit(50, 0);
    const ship = new Ship({ r: s.r, v: [0, 0, 0] });
    const ev = run(ship, 200, NO_INPUT, 1);
    expect(ev).toContain("impact-earth");
    expect(ship.status).toBe("crashed");
  });
});
