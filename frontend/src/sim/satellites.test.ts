import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SatRecord } from "../data/api";
import { ownerGroup } from "../data/satCategories";
import { orbitRing, satDetails, satrecOf, visibilityMask } from "./satellites";

const SNAP = resolve(__dirname, "../../../data/snapshots");
type Tle = { tle0: string; tle1: string; tle2: string; norad_cat_id: number };
const tles: Tle[] = JSON.parse(readFileSync(`${SNAP}/satnogs_tle/tle.json`, "utf8"));
const iss = tles.find((t) => t.norad_cat_id === 25544)!;
const issRec: SatRecord = {
  id: 25544,
  name: "ISS",
  cat: "station",
  orbit: "LEO",
  cc: "RU,US",
  tle: [iss.tle1, iss.tle2],
};
const epochOf = (tle1: string) => {
  const yy = Number(tle1.slice(18, 20));
  const doy = Number(tle1.slice(20, 32));
  return new Date(Date.UTC(2000 + yy, 0, 1) + (doy - 1) * 86_400_000);
};

const recs: SatRecord[] = [
  { id: 1, name: "STARLINK-1007", cat: "starlink", orbit: "LEO", cc: "US" },
  { id: 2, name: "BEIDOU-3 M1", cat: "navigation", orbit: "MEO", cc: "CN" },
  { id: 3, name: "SENTINEL-2A", cat: "earth", orbit: "LEO", cc: "FR" },
  { id: 4, name: "MYSTERY", cat: "other", orbit: "LEO", cc: "" },
];
const allOn = {
  cats: { starlink: true, navigation: true, earth: true, other: true },
  owners: { US: true, China: true, Europe: true, Unknown: true },
  query: "",
};

describe("satellite filters", () => {
  it("owner groups", () => {
    expect(ownerGroup("US,RU")).toBe("US");
    expect(ownerGroup("FR")).toBe("Europe");
    expect(ownerGroup("CN")).toBe("China");
    expect(ownerGroup("")).toBe("Unknown");
    expect(ownerGroup("BR")).toBe("Other");
  });

  it("category, owner and query filters combine", () => {
    expect([...visibilityMask(recs, allOn)]).toEqual([1, 1, 1, 1]);
    expect([...visibilityMask(recs, { ...allOn, cats: { ...allOn.cats, starlink: false } })]).toEqual([
      0, 1, 1, 1,
    ]);
    expect([...visibilityMask(recs, { ...allOn, owners: { ...allOn.owners, China: false } })]).toEqual([
      1, 0, 1, 1,
    ]);
    expect([...visibilityMask(recs, { ...allOn, query: "sentinel" })]).toEqual([0, 0, 1, 0]);
    // "2" matches NORAD id 2 exactly and "SENTINEL-2A" by name
    expect([...visibilityMask(recs, { ...allOn, query: "2" })]).toEqual([0, 1, 1, 0]);
  });
});

describe("satellite details (ISS from the SatNOGS snapshot)", () => {
  const s = satrecOf(issRec)!;
  const at = new Date(epochOf(iss.tle1).getTime() + 3600e3);

  it("has a plausible ISS orbit", () => {
    const d = satDetails(s, at)!;
    expect(d.inclDeg).toBeCloseTo(51.6, 0);
    expect(d.periodMin).toBeGreaterThan(92);
    expect(d.periodMin).toBeLessThan(93.5);
    expect(d.perigeeKm).toBeGreaterThan(370);
    expect(d.apogeeKm).toBeLessThan(450);
    expect(d.altKm).toBeGreaterThan(d.perigeeKm - 25); // geodetic vs equatorial-radius altitude
    expect(Math.abs(d.epochAgeH - 1)).toBeLessThan(0.01);
  });

  it("orbit ring closes on itself after one period", () => {
    const ring = orbitRing(s, at);
    expect(ring.length).toBe(181);
    const a = ring[0]!;
    const b = ring.at(-1)!;
    // one revolution later the inertial position repeats to within drag/J2 drift (tens of km)
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(150);
  });
});
