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
 * Procedural Tiangong (China Space Station), approximate T configuration since late 2022:
 * Tianhe core along the flight direction, Wentian and Mengtian lab modules on the lateral
 * ports of the node, each lab carrying large flexible sun-tracking arrays. A Shenzhou crew ship
 * (nadir) and a Tianzhou cargo ship (aft) are shown because one of each is usually docked.
 * Lengths: Tianhe ~16.6 m, labs ~17.9 m, max diameter 4.2 m; array span ~55 m per lab.
 * Origin: centre of the Tianhe node. Axes: +x forward, +y zenith, +z starboard. Units: metres.
 */
export function buildTiangong(): StationModel {
  const g = new THREE.Group();
  g.name = "Tiangong";
  const staticParts = new THREE.Group();
  g.add(staticParts);

  const p1 = panelMaps([236, 235, 229], 10, 6, 31);
  const p2 = panelMaps([226, 227, 224], 12, 6, 37);
  const hull = new THREE.MeshStandardMaterial({
    map: p1.map,
    bumpMap: p1.bump,
    bumpScale: 0.6,
    roughness: 0.55,
    metalness: 0.08,
  });
  const hull2 = new THREE.MeshStandardMaterial({
    map: p2.map,
    bumpMap: p2.bump,
    bumpScale: 0.6,
    roughness: 0.6,
    metalness: 0.08,
  });
  const metal = new THREE.MeshStandardMaterial({ color: 0xa3a9b1, roughness: 0.35, metalness: 0.8 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.45, metalness: 0.7 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf0efea, roughness: 0.6 });
  const gold = new THREE.MeshStandardMaterial({
    map: foilMap([200, 156, 70], 9),
    roughness: 0.3,
    metalness: 0.9,
  });
  const array = new THREE.MeshStandardMaterial({
    map: cellTexture("#172341", "#3e4f78", 6, 36),
    roughness: 0.28,
    metalness: 0.55,
    side: THREE.DoubleSide,
  });
  const rad = new THREE.MeshStandardMaterial({ map: radiatorMap(), roughness: 0.75, side: THREE.DoubleSide });
  const szGreen = new THREE.MeshStandardMaterial({ map: foilMap([150, 160, 132], 13), roughness: 0.75 });

  const inst = new Instancer();
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const ring = (axis: Axis, x: number, y: number, z: number, r = 0.9) =>
    staticParts.add(cylinder(0.4, r, darkMetal, axis, x, y, z, r, 24));

  // ---------- Tianhe core (node -> small section -> large section -> resource section) ----------
  staticParts.add(sphere(1.4, hull, 0, 0, 0)); // node cabin with five docking ports
  ring("x", 1.45, 0, 0);
  ring("y", 0, -1.45, 0);
  ring("y", 0, 1.45, 0);
  ring("z", 0, 0, 1.45);
  ring("z", 0, 0, -1.45);
  staticParts.add(cylinder(4.2, 1.4, hull, "x", -3.5, 0, 0, 1.4, 40));
  staticParts.add(cylinder(1.0, 2.1, hull, "x", -6.1, 0, 0, 1.4, 40)); // taper (radius grows aft)
  staticParts.add(cylinder(6.0, 2.1, hull, "x", -9.6, 0, 0, 2.1, 40));
  staticParts.add(cylinder(0.8, 1.4, hull2, "x", -13.0, 0, 0, 2.1, 40)); // taper
  staticParts.add(cylinder(3.0, 1.4, gold, "x", -14.9, 0, 0, 1.4, 40)); // resource section (MLI)
  ring("x", -16.6, 0, 0);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    staticParts.add(
      cylinder(0.9, 0.35, darkMetal, "x", -16.2, Math.cos(a) * 1.0, Math.sin(a) * 1.0, 0.12, 16),
    ); // engines
  }
  inst.handrails(v(-3.5, 0, 0), "x", 4.2, 1.4, 4, metal);
  inst.handrails(v(-9.6, 0, 0), "x", 6, 2.1, 6, metal);
  staticParts.add(box(0.12, 4.5, 3.0, rad, -9.6, 0, 2.15)); // body-mounted radiators
  staticParts.add(box(0.12, 4.5, 3.0, rad, -9.6, 0, -2.15));
  // Relay antenna on a mast
  staticParts.add(cylinder(2.2, 0.08, metal, "y", -11.5, 3.2, 0));
  const relay = dish(0.75, white);
  relay.position.set(-11.5, 4.3, 0);
  relay.rotation.x = 0.4;
  staticParts.add(relay);
  // Core-module robotic arm (~10 m), stowed along the large section
  const a0 = v(-6.6, 2.4, 1.2);
  const a1 = v(-11.4, 3.0, 1.0);
  const a2 = v(-15.8, 2.5, 0.4);
  inst.strut(a0, a1, 0.18, white);
  inst.strut(a1, a2, 0.18, white);
  for (const p of [a0, a1, a2]) staticParts.add(sphere(0.3, metal, p.x, p.y, p.z));
  // Tianhe solar arrays (smaller wings near the large section)
  for (const side of [1, -1]) {
    for (let p = 0; p < 4; p++) staticParts.add(box(2.8, 0.06, 2.6, array, -9.6, 0, side * (3.6 + p * 2.75)));
    inst.strut(v(-9.6, 0, side * 2.2), v(-9.6, 0, side * 14.5), 0.06, metal);
  }

  // ---------- Lab modules on the node's lateral ports (Wentian starboard, Mengtian port) ----------
  const trackers: THREE.Group[] = [];
  for (const side of [1, -1]) {
    const lab = side > 0 ? hull : hull2;
    staticParts.add(cylinder(2.2, 1.4, lab, "z", 0, 0, side * 2.5, 1.4, 32)); // airlock/docking section
    staticParts.add(cylinder(15.7, 2.1, lab, "z", 0, 0, side * (3.6 + 7.85), 2.1, 40));
    // end cap tapers outward (cylinder radii are given -z end first)
    staticParts.add(
      cylinder(1.2, side > 0 ? 2.1 : 1.6, gold, "z", 0, 0, side * 20.0, side > 0 ? 1.6 : 2.1, 32),
    );
    inst.handrails(v(0, 0, side * 11.45), "z", 15.7, 2.1, 6, metal);
    staticParts.add(box(3.0, 0.12, 6.0, rad, 0, 2.15, side * 7.5)); // body radiators
    staticParts.add(box(3.0, 0.12, 6.0, rad, 0, -2.15, side * 7.5));
    if (side > 0) {
      // Wentian: crew airlock hatch + small (~5 m) robotic arm
      staticParts.add(cylinder(0.3, 0.6, darkMetal, "x", 2.15, 0, 5.5));
      inst.strut(v(1.8, 2.1, 9), v(3.8, 4.0, 11.5), 0.12, white);
      inst.strut(v(3.8, 4.0, 11.5), v(2.6, 3.4, 14), 0.12, white);
    } else {
      // Mengtian: exposed payload platform with payload boxes + cargo airlock
      staticParts.add(box(4.6, 0.3, 6.0, darkMetal, 0, -2.6, -15.5));
      for (let i = 0; i < 6; i++) {
        inst.box(
          v(-1.4 + (i % 3) * 1.4, -3.3, -13.8 - Math.floor(i / 3) * 2.6),
          v(1.1, 1.0, 1.6),
          i % 2 ? gold : white,
        );
      }
      staticParts.add(cylinder(0.3, 0.9, darkMetal, "x", -2.15, 0, -9));
    }

    // Flexible arrays (~27 m per wing) on a lattice mast; tracking about the lab axis (z)
    const pivot = new THREE.Group();
    pivot.position.set(0, 0, side * 14.5);
    const pi = new Instancer();
    pivot.add(cylinder(1.4, 1.0, darkMetal, "z", 0, 0, 0)); // drive
    for (const dir of [1, -1]) {
      const y0 = dir * 2.4;
      const y1 = dir * 28.4;
      pivot.add(box(0.05, 25.6, 4.2, array, 0, (y0 + y1) / 2, 0));
      pivot.add(box(0.4, 0.4, 4.4, white, 0, y1, 0)); // tip box
      pivot.add(box(0.4, 0.4, 4.4, white, 0, y0, 0)); // root box
      pi.lattice(v(0.3, (y0 + y1) / 2, 0), "y", Math.abs(y1 - y0), 0.35, 0.35, 2.2, 0.02, metal);
    }
    pivot.add(pi.build());
    mergeByMaterial(pivot);
    trackers.push(pivot);
    g.add(pivot);
  }

  // ---------- Shenzhou crew ship at the node's nadir port ----------
  const yS = -1.85;
  staticParts.add(sphere(1.1, szGreen, 0, yS - 1.1, 0)); // orbital module
  staticParts.add(cylinder(2.3, 1.25, szGreen, "y", 0, yS - 3.4, 0, 0.95, 32)); // descent module (bell)
  staticParts.add(cylinder(0.2, 1.3, darkMetal, "y", 0, yS - 4.65, 0)); // heat shield
  staticParts.add(cylinder(2.9, 1.4, white, "y", 0, yS - 6.2, 0, 1.4, 32)); // service module
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    staticParts.add(
      cylinder(0.6, 0.25, darkMetal, "y", Math.cos(a) * 0.8, yS - 7.9, Math.sin(a) * 0.8, 0.1, 12),
    );
  }
  for (const side of [1, -1]) {
    for (let p = 0; p < 3; p++)
      staticParts.add(box(2.0, 0.05, 1.6, array, 0, yS - 6.2, side * (2.3 + p * 2.15)));
  }

  // ---------- Tianzhou cargo ship at the aft port ----------
  staticParts.add(cylinder(6.5, 1.675, hull2, "x", -20.6, 0, 0, 1.675, 40)); // cargo section
  staticParts.add(cylinder(4.1, 1.675, gold, "x", -25.9, 0, 0, 1.675, 40)); // propulsion section
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    staticParts.add(
      cylinder(0.5, 0.28, darkMetal, "x", -28.2, Math.cos(a) * 0.9, Math.sin(a) * 0.9, 0.1, 12),
    );
  }
  for (const side of [1, -1]) {
    for (let p = 0; p < 3; p++)
      staticParts.add(box(2.4, 0.05, 2.2, array, -25.9, 0, side * (2.9 + p * 2.35)));
    inst.strut(v(-25.9, 0, side * 1.7), v(-25.9, 0, side * 8.9), 0.05, metal);
  }

  staticParts.add(inst.build());
  mergeByMaterial(staticParts);
  g.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });

  return {
    group: g,
    spanM: 60,
    trackSun(sun) {
      const a = sunAlpha(sun);
      for (const t of trackers) t.rotation.z = a;
    },
    dispose: () => disposeTree(g),
  };
}
