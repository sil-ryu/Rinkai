import * as THREE from "three";
import { foilMap, Instancer, mergeByMaterial, panelMaps } from "./detail";
import { box, cellTexture, cylinder, disposeTree, type StationModel } from "./parts";

export type CraftModel = StationModel & { setThrottle(t: number): void; setRcs(active: boolean): void };

/**
 * The player's spacecraft, "Rinkai-1": a fictional small crew vehicle (capsule, service module,
 * two solar wings, RCS quads, main engine). Body axes: +x nose, +y top, +z right. Metres.
 * Fixed arrays (no sun tracking): the pilot points the ship.
 */
export function buildCraft(): CraftModel {
  const g = new THREE.Group();
  g.name = "Rinkai-1";
  const staticParts = new THREE.Group();
  g.add(staticParts);

  const p = panelMaps([226, 228, 232], 8, 3, 91);
  const hull = new THREE.MeshStandardMaterial({
    map: p.map,
    bumpMap: p.bump,
    bumpScale: 0.5,
    roughness: 0.5,
    metalness: 0.15,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x30353c, roughness: 0.5, metalness: 0.6 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xa3a9b1, roughness: 0.35, metalness: 0.85 });
  const gold = new THREE.MeshStandardMaterial({
    map: foilMap([200, 156, 70], 3),
    roughness: 0.3,
    metalness: 0.9,
  });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0a1624, roughness: 0.05, metalness: 1 });
  const array = new THREE.MeshStandardMaterial({
    map: cellTexture("#172341", "#3e4f78", 4, 20),
    roughness: 0.3,
    metalness: 0.5,
    side: THREE.DoubleSide,
  });
  const accent = new THREE.MeshStandardMaterial({ color: 0x7cff9b, roughness: 0.4, emissive: 0x0d3a1a });

  // Capsule (cone + nose docking ring), service module, engine
  staticParts.add(cylinder(2.6, 2.0, hull, "x", 2.3, 0, 0, 0.9, 40)); // crew capsule (radius shrinks forward)
  staticParts.add(cylinder(0.5, 0.85, dark, "x", 3.85, 0, 0, 0.8, 24)); // docking adapter
  staticParts.add(cylinder(0.15, 0.95, metal, "x", 4.15, 0, 0, 0.95, 24)); // docking ring
  staticParts.add(cylinder(0.25, 2.05, dark, "x", 0.9, 0, 0)); // heat shield edge
  staticParts.add(cylinder(4.2, 2.0, gold, "x", -1.35, 0, 0, 2.0, 40)); // service module (MLI)
  staticParts.add(cylinder(0.3, 2.06, accent, "x", -0.2, 0, 0)); // accent stripe
  staticParts.add(cylinder(1.6, 0.95, metal, "x", -4.25, 0, 0, 0.35, 32)); // engine bell (throat forward, exit aft)
  for (const [y, z] of [
    [0.7, 0.9],
    [-0.7, -0.9],
  ]) {
    staticParts.add(cylinder(0.25, 0.3, glass, "y", 2.6, y! > 0 ? 1.25 : -1.25, z!)); // windows
  }
  const inst = new Instancer();
  // RCS quads at four positions around the service module
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const y = Math.cos(a) * 2.05;
    const z = Math.sin(a) * 2.05;
    inst.box(new THREE.Vector3(-0.5, y, z), new THREE.Vector3(0.5, 0.35, 0.35), dark);
    for (const dx of [-0.35, 0.35])
      inst.box(new THREE.Vector3(-0.5 + dx, y * 1.08, z * 1.08), new THREE.Vector3(0.12, 0.12, 0.12), metal);
  }
  // Solar wings on booms
  for (const side of [1, -1]) {
    inst.strut(new THREE.Vector3(-1.6, 0, side * 2.0), new THREE.Vector3(-1.6, 0, side * 3.4), 0.08, metal);
    for (let k = 0; k < 3; k++) staticParts.add(box(1.8, 0.05, 1.9, array, -1.6, 0, side * (4.4 + k * 2.0)));
  }
  // High-gain antenna
  inst.strut(new THREE.Vector3(-2.4, 2.0, 0), new THREE.Vector3(-2.4, 3.0, 0), 0.05, metal);
  staticParts.add(cylinder(0.08, 0.6, metal, "y", -2.4, 3.05, 0));
  staticParts.add(inst.build());
  mergeByMaterial(staticParts);
  g.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });

  // Engine plume: additive cone that scales with throttle (not part of the merged mesh)
  const plumeMat = new THREE.MeshBasicMaterial({
    color: 0xffc27a,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const plumeGeo = new THREE.ConeGeometry(0.9, 6, 24, 1, true);
  plumeGeo.rotateZ(-Math.PI / 2); // apex (narrow) at the nozzle, wide end trailing aft
  plumeGeo.translate(-3, 0, 0);
  const plume = new THREE.Mesh(plumeGeo, plumeMat);
  plume.position.set(-5.05, 0, 0);
  plume.visible = false;
  g.add(plume);
  const core = new THREE.Mesh(
    new THREE.ConeGeometry(0.45, 3, 16, 1, true).rotateZ(-Math.PI / 2).translate(-1.5, 0, 0),
    new THREE.MeshBasicMaterial({
      color: 0xfff3dc,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  core.position.copy(plume.position);
  g.add(core);
  const rcsGlow = new THREE.PointLight(0x9fd0ff, 0, 30);
  rcsGlow.position.set(-0.5, 0, 0);
  g.add(rcsGlow);

  return {
    group: g,
    spanM: 22,
    trackSun() {},
    setThrottle(t) {
      const on = t > 0.001;
      plume.visible = core.visible = on;
      plume.scale.set(0.4 + 0.8 * t, 0.6 + 0.4 * t, 0.6 + 0.4 * t);
      core.scale.set(0.5 + 0.7 * t, 1, 1);
      plumeMat.opacity = 0.25 + 0.45 * t;
      (core.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.5 * t;
    },
    setRcs(active) {
      rcsGlow.intensity = active ? 4 : 0;
    },
    dispose: () => disposeTree(g),
  };
}
