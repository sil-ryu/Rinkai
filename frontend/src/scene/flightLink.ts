import * as THREE from "three";
import type { SatRec } from "satellite.js";
import { gmst, inertialOfDateToEcefKm } from "../physics/frames";
import { flight, satrecTarget, type SpawnKind } from "../sim/flight";
import { input } from "../sim/input";
import { satrecOf } from "../sim/satellites";
import type { ShipInput } from "../sim/ship";
import { useLiveSky } from "../store/liveSky";
import { buildCraft, type CraftModel } from "./models/craft";
import { sceneBus } from "./sceneBus";

/**
 * Glue between the flight simulation (sim/flight.ts) and the 3D scene / HUD: reads held keys,
 * steps the ship each frame, poses the craft model and publishes telemetry.
 */
export const SHIP_ID = "ship";
const SHIP_COLOR = "#7cff9b";
const MAX_WARP_THRUSTING = 10;

const links: { craft: CraftModel | null; stationSatrecs: Partial<Record<"iss" | "tiangong", SatRec>> } = {
  craft: null,
  stationSatrecs: {},
};

export function setStationSatrecs(map: Partial<Record<"iss" | "tiangong", SatRec>>) {
  links.stationSatrecs = map;
}

const toastFor: Record<string, [string, "info" | "good" | "bad"]> = {
  docked: ["Docked. Soft capture confirmed.", "good"],
  undocked: ["Undocked.", "info"],
  "impact-earth": ["Impact with the Earth. Ship lost.", "bad"],
  "impact-moon": ["Impact on the Moon. Ship lost.", "bad"],
  collision: ["Collision! Closing speed too high to dock (keep it under 0.5 m/s).", "bad"],
};

export function spawnShip(kind: SpawnKind) {
  const st = useLiveSky.getState();
  const scene = sceneBus.scene;
  if (!scene) return;
  const t = currentSimMs();
  const err = flight.spawn(kind, t, links.stationSatrecs);
  if (err) {
    st.showToast(err, "bad");
    return;
  }
  scene.removeStation(SHIP_ID);
  links.craft = buildCraft();
  scene.addStation(SHIP_ID, "Rinkai-1", SHIP_COLOR, links.craft);
  st.setShipActive(true);
  st.setFlightTarget(kind === "iss" || kind === "tiangong" ? kind : null);
  st.setFlyMenu(false);
  st.showToast("You have control. Shift/Ctrl throttle · WASD/QE attitude · IJKL/HN thrusters", "info");
  // place the model before switching views so the camera has somewhere to go
  poseShip(t);
  st.setView("ship");
}

export function endFlight() {
  flight.despawn();
  sceneBus.scene?.removeStation(SHIP_ID);
  sceneBus.scene?.setPath(null);
  links.craft = null;
  useLiveSky.getState().setShipActive(false);
}

/** Target a station ("iss" | "tiangong"), a catalogue satellite ("sat:<norad>"), or nothing. */
export function setFlightTarget(id: string | null) {
  const st = useLiveSky.getState();
  const t = currentSimMs();
  if (!id) {
    flight.setTarget(null, null, null, t);
    st.setFlightTarget(null);
    return;
  }
  let rec: SatRec | null = null;
  let name = id;
  if (id === "iss" || id === "tiangong") {
    rec = links.stationSatrecs[id] ?? null;
    name = id === "iss" ? "ISS" : "Tiangong";
  } else if (id.startsWith("sat:")) {
    const norad = Number(id.slice(4));
    const r = st.satellites.env?.data.satellites.find((s) => s.id === norad);
    rec = r ? satrecOf(r) : null;
    name = r?.name ?? id;
  }
  if (!rec) {
    st.showToast("Target unavailable", "bad");
    return;
  }
  flight.setTarget(id, name, satrecTarget(rec), t);
  st.setFlightTarget(id);
}

function currentSimMs() {
  const { clock } = useLiveSky.getState();
  return clock.paused ? clock.anchorSim : clock.anchorSim + (Date.now() - clock.anchorReal) * clock.rate;
}

const qM = new THREE.Quaternion();
const mM = new THREE.Matrix4();
const qWorld = new THREE.Quaternion();

function poseShip(tMs: number) {
  const ship = flight.ship;
  const scene = sceneBus.scene;
  if (!ship || !scene) return;
  const date = new Date(tMs);
  const pos = inertialOfDateToEcefKm({ x: ship.r[0], y: ship.r[1], z: ship.r[2] }, date);
  const vel = inertialOfDateToEcefKm({ x: ship.v[0], y: ship.v[1], z: ship.v[2] }, date);
  const vn = Math.hypot(vel.x, vel.y, vel.z) || 1;
  scene.setStationState(SHIP_ID, pos, { x: vel.x / vn, y: vel.y / vn, z: vel.z / vn });
  // Attitude: inertial -> Earth-fixed (rotate by -GMST about z) -> scene axes (x, z, -y)
  const g = gmst(date);
  const c = Math.cos(g);
  const s = Math.sin(g);
  mM.set(c, s, 0, 0, 0, 0, 1, 0, s, -c, 0, 0, 0, 0, 0, 1);
  qM.setFromRotationMatrix(mM);
  scene.setStationAttitude(SHIP_ID, qWorld.copy(qM).multiply(ship.q));
}

let lastPath = 0;
let lastTelemetry = 0;
let lastReal = performance.now();

/** Called once per rendered frame from <Globe />. */
export function flightFrame(tMs: number) {
  const nowReal = performance.now();
  const realDt = Math.min((nowReal - lastReal) / 1000, 0.1);
  lastReal = nowReal;
  const ship = flight.ship;
  const scene = sceneBus.scene;
  if (!ship || !scene) return;
  const st = useLiveSky.getState();
  const piloting = st.view === "ship" && ship.status !== "crashed";

  const inp: ShipInput = piloting
    ? {
        pitch: input.axis("w", "s"), // W = nose down, S = nose up
        yaw: input.axis("d", "a"),
        roll: input.axis("q", "e"),
        rcs: [input.axis("k", "i"), input.axis("n", "h"), input.axis("j", "l")],
      }
    : { pitch: 0, yaw: 0, roll: 0, rcs: [0, 0, 0] };
  if (piloting) {
    const dThr = (input.isDown("shift") ? 1 : 0) - (input.isDown("control") ? 1 : 0);
    if (dThr) ship.throttle = THREE.MathUtils.clamp(ship.throttle + dThr * 0.6 * realDt, 0, 1);
  }
  const thrusting = ship.throttle > 0 || inp.rcs.some((c) => c !== 0);
  if (thrusting && !st.clock.paused && st.clock.rate > MAX_WARP_THRUSTING) {
    st.setTimeRate(MAX_WARP_THRUSTING);
    st.showToast(`Time warp limited to ${MAX_WARP_THRUSTING}× while the engine is firing`, "info");
  }

  for (const ev of flight.update(tMs, inp)) {
    const [text, kind] = toastFor[ev] ?? [ev, "info"];
    st.showToast(text, kind);
  }
  poseShip(tMs);
  links.craft?.setThrottle(ship.status === "flying" ? ship.throttle : 0);
  links.craft?.setRcs(inp.rcs.some((c) => c !== 0));

  if (nowReal - lastPath > 300) {
    lastPath = nowReal;
    const path = ship.status === "crashed" ? null : flight.path(tMs);
    scene.setPath(path?.points ?? null, path?.markers ?? []);
  }
  if (nowReal - lastTelemetry > 200) {
    lastTelemetry = nowReal;
    st.setTelemetry(flight.telemetry(tMs));
  }
}
