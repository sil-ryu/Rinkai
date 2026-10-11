import { describe, expect, it } from "vitest";
import { formatOffset, isLive, jumpBy, liveClock, setPaused, setRate, simNow, stepRate } from "./clock";

const T0 = Date.parse("2026-10-11T00:00:00Z");

describe("sim clock", () => {
  it("tracks real time when live", () => {
    const c = liveClock(T0);
    expect(simNow(c, T0 + 5000)).toBe(T0 + 5000);
    expect(isLive(c, T0 + 5000)).toBe(true);
  });

  it("changing rate never jumps sim time", () => {
    let c = liveClock(T0);
    c = setRate(c, 600, T0 + 1000);
    expect(simNow(c, T0 + 1000)).toBe(T0 + 1000);
    expect(simNow(c, T0 + 2000)).toBe(T0 + 1000 + 600_000);
    expect(isLive(c, T0 + 2000)).toBe(false);
  });

  it("pause freezes and resume continues from the same instant", () => {
    let c = setRate(liveClock(T0), 60, T0);
    c = setPaused(c, true, T0 + 1000); // sim = T0 + 60 s
    expect(simNow(c, T0 + 99_000)).toBe(T0 + 60_000);
    c = setPaused(c, false, T0 + 100_000);
    expect(simNow(c, T0 + 101_000)).toBe(T0 + 120_000);
  });

  it("jumps by a delta", () => {
    const c = jumpBy(liveClock(T0), -3_600_000, T0);
    expect(simNow(c, T0)).toBe(T0 - 3_600_000);
  });

  it("steps through preset rates and clamps at the ends", () => {
    expect(stepRate(1, 1)).toBe(10);
    expect(stepRate(600, -1)).toBe(60);
    expect(stepRate(1, -1)).toBe(1);
    expect(stepRate(3600, 1)).toBe(3600);
  });

  it("formats offsets", () => {
    expect(formatOffset(0)).toBe("+0s");
    expect(formatOffset(-90_000)).toBe("−1m 30s");
    expect(formatOffset(3 * 3600e3 + 12 * 60e3)).toBe("+3h 12m");
    expect(formatOffset(2 * 86400e3 + 5 * 3600e3)).toBe("+2d 5h");
  });
});
