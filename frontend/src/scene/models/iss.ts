import * as THREE from "three";
import { dish, foilMap, Instancer, mergeByMaterial, panelMaps, radiatorMap } from "./detail";
import {
  box,
  cellTexture,
  cylinder,
  disposeTree,
  sphere,
  sunAlpha,
  type Axis,
  type StationModel,
} from "./parts";

/**
 * Procedural ISS, approximate configuration (2020s). Dimensions follow published module
 * figures (truss ~109 m, array wings ~35 m x 11.6 m, Destiny 8.5 m x 4.3 m, ...); placement is
 * simplified and visiting vehicles are omitted because they change month to month.
 * Origin: centre of Unity (Node 1). Axes: +x forward, +y zenith, +z starboard. Units: metres.
 */
export function buildIss(): StationModel {
  const g = new THREE.Group();
  g.name = "ISS";
  const staticParts = new THREE.Group();
  g.add(staticParts);

  // ---------- materials ----------
  const usPanels = panelMaps([232, 231, 225], 8, 6, 11);
  const ruPanels = panelMaps([206, 210, 196], 10, 5, 23);
  const usHull = new THREE.MeshStandardMaterial({
    map: usPanels.map,
    bumpMap: usPanels.bump,
    bumpScale: 0.6,
    roughness: 0.55,
    metalness: 0.1,
  });
  const ruHull = new THREE.MeshStandardMaterial({
    map: ruPanels.map,
    bumpMap: ruPanels.bump,
    bumpScale: 0.6,
    roughness: 0.65,
    metalness: 0.05,
  });
  const metal = new THREE.MeshStandardMaterial({ color: 0xa3a9b1, roughness: 0.35, metalness: 0.8 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x5d636b, roughness: 0.45, metalness: 0.7 });
  const trussMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.4, metalness: 0.65 });
  const gold = new THREE.MeshStandardMaterial({
    map: foilMap([196, 150, 62], 5),
    roughness: 0.3,
    metalness: 0.9,
  });
  const silverFoil = new THREE.MeshStandardMaterial({
    map: foilMap([200, 200, 205], 7),
    roughness: 0.35,
    metalness: 0.85,
  });
  const glass = new THREE.MeshStandardMaterial({ color: 0x08111c, roughness: 0.05, metalness: 1.0 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf0efea, roughness: 0.6 });
  const array = new THREE.MeshStandardMaterial({
    map: cellTexture("#6b4318", "#a77a3e", 8, 40),
    roughness: 0.32,
    metalness: 0.5,
    side: THREE.DoubleSide,
  });
  const rosa = new THREE.MeshStandardMaterial({
    map: cellTexture("#1b2844", "#45557a", 6, 24),
    roughness: 0.28,
    metalness: 0.55,
    side: THREE.DoubleSide,
  });
  const rad = new THREE.MeshStandardMaterial({ map: radiatorMap(), roughness: 0.75, side: THREE.DoubleSide });

  const inst = new Instancer();
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  /** Pressurized module: hull + conical end bulkheads + handrails. */
  const module = (
    len: number,
    r: number,
    mat: THREE.Material,
    axis: Axis,
    x: number,
    y: number,
    z: number,
    rails = 4,
  ) => {
    staticParts.add(cylinder(len - 0.7, r, mat, axis, x, y, z, r, 40));
    const off = (len - 0.7) / 2 + 0.175;
    const o = axis === "x" ? v(off, 0, 0) : axis === "y" ? v(0, off, 0) : v(0, 0, off);
    // cylinder radii are given (-axis end, +axis end)
    staticParts.add(cylinder(0.35, r, mat, axis, x + o.x, y + o.y, z + o.z, r * 0.82, 40));
    staticParts.add(cylinder(0.35, r * 0.82, mat, axis, x - o.x, y - o.y, z - o.z, r, 40));
    if (rails) inst.handrails(v(x, y, z), axis, len, r, rails, metal);
  };
  /** Common Berthing Mechanism ring between two modules. */
  const cbm = (axis: Axis, x: number, y: number, z: number, r = 1.05) => {
    staticParts.add(cylinder(0.45, r, darkMetal, axis, x, y, z, r, 24));
  };

  // ---------- US Orbital Segment ----------
  module(5.5, 2.3, usHull, "x", 0, 0, 0); // Unity
  cbm("x", 2.85, 0, 0);
  module(8.5, 2.15, usHull, "x", 7.05, 0, 0); // Destiny
  staticParts.add(cylinder(0.12, 0.3, glass, "y", 7.05, -2.17, 0)); // Destiny science window
  cbm("x", 11.4, 0, 0);
  module(7.2, 2.2, usHull, "x", 14.95, 0, 0); // Harmony
  staticParts.add(cylinder(1.6, 1.0, metal, "x", 19.3, 0, 0, 0.75)); // PMA-2
  staticParts.add(cylinder(0.5, 1.2, darkMetal, "x", 20.3, 0, 0)); // IDA-2
  staticParts.add(cylinder(1.6, 0.75, metal, "y", 14.95, 3.0, 0, 1.0)); // PMA-3 (zenith)
  staticParts.add(cylinder(0.5, 1.2, darkMetal, "y", 14.95, 4.0, 0)); // IDA-3
  cbm("z", 14.95, 0, 2.35);
  module(7.0, 2.25, usHull, "z", 14.95, 0, 5.9); // Columbus
  for (let i = 0; i < 4; i++) {
    // Columbus external payloads
    inst.box(
      v(14.95 + (i % 2 ? 1.3 : -1.3), i < 2 ? 1.9 : -1.9, 9.3),
      v(1.2, 1.0, 1.4),
      i % 2 ? gold : white,
    );
  }
  cbm("z", 14.95, 0, -2.35);
  module(11.2, 2.2, usHull, "z", 14.95, 0, -8.15); // Kibo pressurized module
  module(4.2, 2.1, usHull, "y", 14.95, 4.45, -8.15, 2); // Kibo logistics module
  staticParts.add(box(5.0, 1.0, 5.6, darkMetal, 14.95, 0, -16.6)); // Kibo exposed facility
  for (let i = 0; i < 6; i++) {
    inst.box(
      v(13.2 + (i % 3) * 1.7, 0.9, -15.2 - Math.floor(i / 3) * 2.6),
      v(1.3, 0.8, 1.6),
      i % 2 ? gold : silverFoil,
    );
  }
  staticParts.add(cylinder(2.6, 0.15, white, "z", 16.6, 2.4, -11.2)); // JEM arm boom
  staticParts.add(cylinder(2.6, 0.15, white, "x", 15.3, 2.4, -12.5));

  cbm("z", 0, 0, -2.45);
  module(6.7, 2.25, usHull, "z", 0, 0, -6.0); // Tranquility (Node 3)
  // Cupola: base ring, hexagonal window frustum, top window, six side windows
  staticParts.add(cylinder(0.55, 1.48, metal, "y", 0, -2.55, -6.0, 1.48, 24));
  staticParts.add(cylinder(0.8, 1.0, darkMetal, "y", 0, -3.2, -6.0, 1.42, 6));
  staticParts.add(cylinder(0.06, 0.55, glass, "y", 0, -3.63, -6.0, 0.55, 24));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const w = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.6), glass);
    w.position.set(Math.cos(a) * 1.18, -3.2, -6.0 + Math.sin(a) * 1.18);
    w.lookAt(Math.cos(a) * 3, -3.6, -6.0 + Math.sin(a) * 3);
    staticParts.add(w);
  }
  module(6.6, 2.2, usHull, "x", 5.75, 0, -6.0); // Leonardo PMM
  staticParts.add(cylinder(4.0, 1.6, silverFoil, "x", -4.45, 0, -6.0)); // BEAM (fabric)
  cbm("z", 0, 0, 2.5);
  module(5.5, 2.0, usHull, "z", 0, 0, 5.3); // Quest airlock
  staticParts.add(cylinder(1.4, 1.0, usHull, "y", 0, 1.9, 7.0)); // Quest crewlock bump

  // Z1 truss with Ku-band antenna, on Unity zenith
  staticParts.add(box(3.2, 2.2, 3.4, trussMat, 0, 3.4, 0));
  staticParts.add(cylinder(2.8, 0.12, metal, "y", 1.2, 5.6, 1.0));
  const ku = dish(1.0, white);
  ku.position.set(1.2, 7.0, 1.0);
  ku.rotation.z = -0.5;
  staticParts.add(ku);

  // ---------- Russian Orbital Segment ----------
  staticParts.add(cylinder(1.9, 1.0, metal, "x", -3.75, 0, 0, 0.8)); // PMA-1
  module(12.6, 2.05, ruHull, "x", -10.95, 0, 0, 2); // Zarya
  staticParts.add(sphere(1.6, ruHull, -18.2, 0, 0)); // Zvezda transfer compartment
  staticParts.add(cylinder(3.5, 1.45, ruHull, "x", -20.6, 0, 0)); // Zvezda small section
  staticParts.add(cylinder(0.8, 2.07, ruHull, "x", -22.75, 0, 0, 1.45)); // taper
  module(8.3, 2.07, ruHull, "x", -27.3, 0, 0, 2); // Zvezda working section
  staticParts.add(cylinder(1.4, 1.2, gold, "x", -32.1, 0, 0, 1.9)); // aft MLI-wrapped assembly compartment
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    staticParts.add(
      cylinder(0.5, 0.12, darkMetal, "x", -32.9, Math.cos(a) * 1.4, Math.sin(a) * 1.4, 0.04, 10),
    ); // thrusters
  }
  module(4.0, 1.27, ruHull, "y", -18.2, 3.6, 0, 2); // Poisk (zenith)
  module(13.1, 2.1, ruHull, "y", -18.2, -8.2, 0, 3); // Nauka (nadir)
  staticParts.add(box(0.12, 6, 3.2, rad, -15.9, -9, 0)); // Nauka radiator
  staticParts.add(sphere(1.65, ruHull, -18.2, -16.4, 0)); // Prichal node
  module(6.0, 1.17, ruHull, "y", -10.95, -5.1, 0, 2); // Rassvet
  // European Robotic Arm on Nauka (folded)
  inst.strut(v(-16.2, -5, 1.6), v(-16.2, -11, 1.6), 0.13, white);
  inst.strut(v(-16.2, -11, 1.6), v(-14.5, -11, 3.5), 0.13, white);

  // Zvezda solar arrays (four panels per wing on a boom)
  for (const side of [1, -1]) {
    for (let p = 0; p < 4; p++)
      staticParts.add(box(3.1, 0.06, 3.2, array, -28.5, 0, side * (3.6 + p * 3.35)));
    inst.strut(v(-28.5, 0, side * 2.0), v(-28.5, 0, side * 16.6), 0.06, metal);
  }

  // ---------- Integrated truss (~109 m along z) on top of Destiny ----------
  const trussY = 4.8;
  const trussX = 7.05;
  inst.lattice(v(trussX, trussY, 0), "z", 109, 4.2, 3.4, 4.5, 0.07, trussMat);
  staticParts.add(box(3.0, 2.8, 4.4, trussMat, trussX, trussY, 0)); // S0 centre segment (solid)
  for (const side of [1, -1]) {
    staticParts.add(cylinder(1.4, 2.0, darkMetal, "z", trussX, trussY, side * 30.5, 2.0, 24)); // SARJ
    staticParts.add(box(3.4, 1.6, 2.0, metal, trussX - 0.4, trussY + 2.4, side * 6)); // ammonia tank assemblies
    for (let i = 0; i < 3; i++) {
      // ELC external carriers
      inst.box(
        v(trussX + 2.6, trussY + (i - 1) * 0.9, side * (22 + i * 1.6)),
        v(1.2, 0.8, 1.3),
        i % 2 ? gold : white,
      );
    }
  }
  // Mobile base + Canadarm2 with joints and end effector
  staticParts.add(box(4.2, 1.0, 4.6, metal, trussX + 2.4, trussY + 2.2, 4));
  const shoulder = v(trussX + 2.4, trussY + 3.0, 4);
  const elbow = v(trussX + 9, trussY + 7.5, 7);
  const wrist = v(trussX + 15.5, trussY + 4.5, 3.5);
  inst.strut(shoulder, elbow, 0.19, white);
  inst.strut(elbow, wrist, 0.19, white);
  for (const p of [shoulder, elbow, wrist]) staticParts.add(sphere(0.35, metal, p.x, p.y, p.z));
  staticParts.add(cylinder(0.9, 0.3, darkMetal, "y", wrist.x, wrist.y - 0.6, wrist.z));

  // ---------- Heat-rejection radiators on S1/P1 (rotate edge-on to the Sun) ----------
  const radiators: THREE.Group[] = [];
  for (const z of [12.5, -12.5]) {
    const pivot = new THREE.Group();
    pivot.position.set(trussX, trussY, z);
    const ri = new Instancer();
    for (let i = 0; i < 3; i++) {
      pivot.add(box(0.12, 23, 3.2, rad, 0, -12.5, (i - 1) * 3.4));
      ri.strut(v(0, -1, (i - 1) * 3.4 - 1.6), v(0, -24, (i - 1) * 3.4 - 1.6), 0.05, metal);
      ri.strut(v(0, -1, (i - 1) * 3.4 + 1.6), v(0, -24, (i - 1) * 3.4 + 1.6), 0.05, metal);
    }
    pivot.add(ri.build());
    mergeByMaterial(pivot);
    radiators.push(pivot);
    g.add(pivot);
  }

  // ---------- Solar arrays: 4 photovoltaic modules per side, sun-tracking (alpha) ----------
  // Each wing: two blankets (4.6 m) either side of a lattice mast, blanket boxes at both ends,
  // beta gimbal at the root. iROSA roll-out arrays (from 2021) are canted over six wings here.
  const withRosa = new Set(["S37+", "S37-", "P37+", "P37-", "S51+", "P51+"]);
  const sarjs: THREE.Group[] = [];
  for (const side of [1, -1]) {
    const sarj = new THREE.Group();
    sarj.position.set(trussX, trussY, 0);
    const si = new Instancer();
    for (const zAbs of [37, 51]) {
      const zc = side * zAbs;
      sarj.add(box(2.4, 2.4, 2.4, darkMetal, 0, 0, zc)); // beta gimbal assembly
      for (const dir of [1, -1]) {
        const y0 = dir * 1.6;
        const y1 = dir * 35.5;
        for (const dz of [-3.5, 3.5]) {
          sarj.add(box(0.05, 33, 4.6, array, 0, (y0 + y1) / 2, zc + dz)); // blanket
          sarj.add(box(0.5, 0.5, 4.8, silverFoil, 0, y1, zc + dz)); // blanket box (tip)
          sarj.add(box(0.5, 0.5, 4.8, silverFoil, 0, y0 + dir * 0.4, zc + dz)); // blanket box (root)
        }
        si.lattice(v(0, (y0 + y1) / 2, zc), "y", Math.abs(y1 - y0), 0.5, 0.5, 2.5, 0.025, metal); // FAST mast
        const key = `${side > 0 ? "S" : "P"}${zAbs}${dir > 0 ? "+" : "-"}`;
        if (withRosa.has(key)) {
          const r = box(0.05, 19, 6.0, rosa, 0.9, dir * (3 + 19 / 2), zc);
          r.rotation.z = -dir * 0.17;
          sarj.add(r);
          for (const dz of [-3.0, 3.0])
            si.strut(v(0.4, dir * 3, zc + dz), v(1.9, dir * 22, zc + dz), 0.06, metal);
        }
      }
      sarj.add(box(0.1, 3.6, 4.2, rad, -2.6, -3.2, side * (zAbs - 7))); // photovoltaic radiator
    }
    sarj.add(si.build());
    mergeByMaterial(sarj);
    sarjs.push(sarj);
    g.add(sarj);
  }

  staticParts.add(inst.build());
  mergeByMaterial(staticParts);
  g.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });

  return {
    group: g,
    spanM: 110,
    trackSun(sun) {
      const a = sunAlpha(sun);
      for (const s of sarjs) s.rotation.z = a;
      for (const r of radiators) r.rotation.z = a + Math.PI / 2; // edge-on to the Sun
    },
    dispose: () => disposeTree(g),
  };
}
