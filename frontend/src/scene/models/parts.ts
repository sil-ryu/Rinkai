import * as THREE from "three";

/**
 * Building blocks for procedural station models. Units are metres. Model axes follow the
 * station body frame used for LVLH flight: +x = velocity (forward), +y = zenith (away from
 * Earth), +z = starboard.
 */

export type Axis = "x" | "y" | "z";

export type StationModel = {
  group: THREE.Group;
  /** Point the sun-tracking arrays (and edge-on radiators) at the Sun; `sun` is a unit vector in model axes. */
  trackSun(sun: THREE.Vector3): void;
  dispose(): void;
  /** Rough span in metres, for camera framing. */
  spanM: number;
};

/** Cylinder of `length` along `axis`, centred at (x, y, z). */
export function cylinder(
  length: number,
  radius: number,
  mat: THREE.Material,
  axis: Axis,
  x = 0,
  y = 0,
  z = 0,
  radiusEnd = radius,
  segments = 32,
): THREE.Mesh {
  const g = new THREE.CylinderGeometry(radiusEnd, radius, length, segments, 1);
  // CylinderGeometry runs along +y from radiusBottom (-y) to radiusTop (+y).
  if (axis === "x") g.rotateZ(-Math.PI / 2);
  if (axis === "z") g.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  return m;
}

export function box(
  sx: number,
  sy: number,
  sz: number,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(x, y, z);
  return m;
}

export function sphere(r: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), mat);
  m.position.set(x, y, z);
  return m;
}

/** Canvas texture of solar cells: dark cells with thin lighter gridlines. */
export function cellTexture(base: string, line: string, cellsX: number, cellsY: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = base;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = line;
  g.lineWidth = 2;
  for (let i = 0; i <= cellsX; i++) {
    const x = (i / cellsX) * c.width;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, c.height);
    g.stroke();
  }
  for (let j = 0; j <= cellsY; j++) {
    const y = (j / cellsY) * c.height;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(c.width, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Transparent lattice texture for open trusses. */
export function latticeTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.strokeStyle = "#ffffff";
  g.lineWidth = 14;
  g.strokeRect(7, 7, 114, 114);
  g.lineWidth = 10;
  g.beginPath();
  g.moveTo(4, 4);
  g.lineTo(124, 124);
  g.moveTo(124, 4);
  g.lineTo(4, 124);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/**
 * A solar-array wing: `blankets` flat blankets side by side (along z) separated by `gap`,
 * extending `length` along +y from a short mast base at the origin.
 */
export function solarWing(
  length: number,
  blanketWidth: number,
  blankets: number,
  gap: number,
  mat: THREE.Material,
  mastMat: THREE.Material,
): THREE.Group {
  const wing = new THREE.Group();
  const total = blankets * blanketWidth + (blankets - 1) * gap;
  for (let i = 0; i < blankets; i++) {
    const z = -total / 2 + blanketWidth / 2 + i * (blanketWidth + gap);
    wing.add(box(0.08, length, blanketWidth, mat, 0, 1 + length / 2, z));
  }
  if (blankets > 1) wing.add(cylinder(length, 0.12, mastMat, "y", 0, 1 + length / 2, 0, 0.12, 8));
  wing.add(box(0.6, 1.2, Math.min(total, 2), mastMat, 0, 0.6, 0));
  return wing;
}

/** Dispose every geometry, material and texture under `root`. */
export function disposeTree(root: THREE.Object3D) {
  const mats = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mm = m.material;
    if (Array.isArray(mm)) mm.forEach((x) => mats.add(x));
    else if (mm) mats.add(mm);
  });
  for (const m of mats) {
    for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
    m.dispose();
  }
}

/** Angle about +z that turns a +x-facing array normal toward the Sun (projected onto the x-y plane). */
export const sunAlpha = (sun: THREE.Vector3): number => Math.atan2(sun.y, sun.x);
