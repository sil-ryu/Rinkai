import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Axis } from "./parts";

/** Deterministic PRNG so procedural textures look the same on every load. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/**
 * Micrometeoroid-shield panels: a grid of slightly varied rectangles with dark seams and
 * fastener dots. Returns colour and bump maps sharing one layout. Cylinder UVs run u around
 * the circumference and v along the length, so `cols` x `rows` maps to panels.
 */
export function panelMaps(base: [number, number, number], cols: number, rows: number, seed: number) {
  const W = 512;
  const H = 512;
  const r = rng(seed);
  const layout: [number, number, number, number, number][] = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) layout.push([(i * W) / cols, (j * H) / rows, W / cols, H / rows, r()]);
  }
  const map = canvasTex(W, H, (g) => {
    for (const [x, y, w, h, v] of layout) {
      const k = 0.93 + v * 0.1;
      g.fillStyle = `rgb(${base.map((c) => Math.min(255, Math.round(c * k))).join(",")})`;
      g.fillRect(x, y, w, h);
      g.fillStyle = "rgba(0,0,0,0.22)";
      for (const [fx, fy] of [
        [x + 6, y + 6],
        [x + w - 6, y + 6],
        [x + 6, y + h - 6],
        [x + w - 6, y + h - 6],
      ])
        g.fillRect(fx! - 1.5, fy! - 1.5, 3, 3);
    }
    g.strokeStyle = "rgba(60,60,60,0.28)";
    g.lineWidth = 2;
    for (const [x, y, w, h] of layout) g.strokeRect(x, y, w, h);
  });
  const bump = canvasTex(
    W,
    H,
    (g) => {
      g.fillStyle = "#fff";
      g.fillRect(0, 0, W, H);
      g.strokeStyle = "#000";
      g.lineWidth = 4;
      for (const [x, y, w, h] of layout) g.strokeRect(x, y, w, h);
    },
    false,
  );
  return { map, bump };
}

/** Crinkled multi-layer insulation foil (gold or silver). */
export function foilMap(rgb: [number, number, number], seed: number) {
  const r = rng(seed);
  return canvasTex(256, 256, (g) => {
    g.fillStyle = `rgb(${rgb.join(",")})`;
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      const l = r() < 0.5 ? 255 : 0;
      g.fillStyle = `rgba(${l},${l},${l},${0.04 + r() * 0.08})`;
      g.beginPath();
      g.ellipse(r() * 256, r() * 256, 2 + r() * 14, 1 + r() * 5, r() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** Radiator panel: white with fine vertical flow-tube ribs. */
export function radiatorMap() {
  return canvasTex(256, 64, (g) => {
    g.fillStyle = "#f2f2ee";
    g.fillRect(0, 0, 256, 64);
    g.strokeStyle = "rgba(120,120,120,0.35)";
    g.lineWidth = 2;
    for (let x = 4; x < 256; x += 12) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 64);
      g.stroke();
    }
  });
}

const UNIT_CYL = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const Y = new THREE.Vector3(0, 1, 0);

/**
 * Collects many small repeated parts (struts, rails, boxes) and emits one InstancedMesh per
 * (shape, material): hundreds of truss members cost a couple of draw calls.
 */
export class Instancer {
  private items = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material; m: THREE.Matrix4[] }>();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();

  private push(kind: "cyl" | "box", mat: THREE.Material, m: THREE.Matrix4) {
    const key = `${kind}:${mat.uuid}`;
    let e = this.items.get(key);
    if (!e) {
      e = { geo: kind === "cyl" ? UNIT_CYL : UNIT_BOX, mat, m: [] };
      this.items.set(key, e);
    }
    e.m.push(m);
  }

  /** Round strut from a to b. */
  strut(a: THREE.Vector3, b: THREE.Vector3, radius: number, mat: THREE.Material) {
    const dir = this.v.subVectors(b, a);
    const len = dir.length();
    if (len < 1e-6) return;
    this.q.setFromUnitVectors(Y, dir.normalize());
    const mid = a.clone().add(b).multiplyScalar(0.5);
    this.push(
      "cyl",
      mat,
      new THREE.Matrix4().compose(mid, this.q.clone(), new THREE.Vector3(radius, len, radius)),
    );
  }

  box(center: THREE.Vector3, size: THREE.Vector3, mat: THREE.Material, rot?: THREE.Euler) {
    const q = rot ? new THREE.Quaternion().setFromEuler(rot) : new THREE.Quaternion();
    this.push("box", mat, new THREE.Matrix4().compose(center.clone(), q, size.clone()));
  }

  /** Rectangular-section lattice truss along `axis`, centred at `c`, with bays of `bay` metres. */
  lattice(
    c: THREE.Vector3,
    axis: Axis,
    length: number,
    w: number,
    h: number,
    bay: number,
    r: number,
    mat: THREE.Material,
  ) {
    const along = (t: number, u: number, v: number) => {
      // t along the axis, u/v across it
      if (axis === "z") return new THREE.Vector3(c.x + u, c.y + v, c.z + t);
      if (axis === "x") return new THREE.Vector3(c.x + t, c.y + v, c.z + u);
      return new THREE.Vector3(c.x + u, c.y + t, c.z + v);
    };
    const corners: [number, number][] = [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2],
      [-w / 2, h / 2],
    ];
    const n = Math.max(1, Math.round(length / bay));
    const step = length / n;
    for (const [u, v] of corners) this.strut(along(-length / 2, u, v), along(length / 2, u, v), r * 1.4, mat);
    for (let i = 0; i <= n; i++) {
      const t = -length / 2 + i * step;
      for (let k = 0; k < 4; k++) {
        const [u1, v1] = corners[k]!;
        const [u2, v2] = corners[(k + 1) % 4]!;
        this.strut(along(t, u1, v1), along(t, u2, v2), r, mat);
        if (i < n) {
          // alternate the diagonal direction per bay, like a Warren truss
          const t2 = t + step;
          if (i % 2) this.strut(along(t, u1, v1), along(t2, u2, v2), r * 0.8, mat);
          else this.strut(along(t, u2, v2), along(t2, u1, v1), r * 0.8, mat);
        }
      }
    }
  }

  /** Handrails: `count` rails around a cylinder module, each on two standoffs. */
  handrails(
    c: THREE.Vector3,
    axis: Axis,
    length: number,
    radius: number,
    count: number,
    mat: THREE.Material,
    phase = 0.4,
  ) {
    for (let k = 0; k < count; k++) {
      const a = phase + (k / count) * Math.PI * 2;
      const u = Math.cos(a);
      const v = Math.sin(a);
      const at = (t: number, rr: number) =>
        axis === "z"
          ? new THREE.Vector3(c.x + u * rr, c.y + v * rr, c.z + t)
          : axis === "x"
            ? new THREE.Vector3(c.x + t, c.y + v * rr, c.z + u * rr)
            : new THREE.Vector3(c.x + u * rr, c.y + t, c.z + v * rr);
      const L = length * 0.38;
      this.strut(at(-L, radius + 0.18), at(L, radius + 0.18), 0.025, mat);
      this.strut(at(-L * 0.8, radius), at(-L * 0.8, radius + 0.18), 0.02, mat);
      this.strut(at(L * 0.8, radius), at(L * 0.8, radius + 0.18), 0.02, mat);
    }
  }

  build(): THREE.Group {
    const g = new THREE.Group();
    for (const { geo, mat, m } of this.items.values()) {
      const im = new THREE.InstancedMesh(geo, mat, m.length);
      m.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      g.add(im);
    }
    return g;
  }
}

/**
 * Merge every plain Mesh under `group` (recursively) into one mesh per material, preserving
 * transforms relative to `group`. InstancedMeshes are kept as they are. Cuts a model with
 * hundreds of parts down to a handful of draw calls.
 */
export function mergeByMaterial(group: THREE.Group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const victims: THREE.Mesh[] = [];
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material))
      return;
    const geo = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const g2 = geo.index ? geo.toNonIndexed() : geo;
    for (const name of Object.keys(g2.attributes))
      if (!["position", "normal", "uv"].includes(name)) g2.deleteAttribute(name);
    if (!g2.attributes.uv) return;
    const list = buckets.get(m.material) ?? [];
    list.push(g2);
    buckets.set(m.material, list);
    victims.push(m);
  });
  for (const m of victims) {
    m.removeFromParent();
    m.geometry.dispose();
  }
  // drop now-empty helper groups
  for (const child of [...group.children]) {
    if (child.type === "Group" && child.children.length === 0) child.removeFromParent();
  }
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (merged) group.add(new THREE.Mesh(merged, mat));
  }
}

/** Parabolic dish antenna facing +y, rim radius r. */
export function dish(r: number, mat: THREE.Material): THREE.Mesh {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const x = (i / 12) * r;
    pts.push(new THREE.Vector2(x, (x * x) / (4 * r * 0.6)));
  }
  const geo = new THREE.LatheGeometry(pts, 24);
  return new THREE.Mesh(geo, mat);
}
