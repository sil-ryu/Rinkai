import { useEffect, useRef } from "react";
import type { OMMJsonObject, SatRec } from "satellite.js";
import type { StationId } from "../data/api";
import { STATION_STYLE } from "../hud/stationStyle";
import { oemStateAt, type OemSegment } from "../physics/oem";
import { elementAgeHours, propagateSat, satrecFromOmm } from "../physics/sgp4";
import { sunDirectionEcef } from "../physics/sun";
import { simNow } from "../sim/clock";
import { useLiveSky, type StationLive } from "../store/liveSky";
import { GlobeScene, TRACK_POINTS } from "./GlobeScene";
import { buildIss } from "./models/iss";
import type { StationModel } from "./models/parts";
import { buildTiangong } from "./models/tiangong";
import { sceneBus } from "./sceneBus";

const HUD_EVERY_MS = 250; // real time
const TRACK_EVERY_SIM_MS = 15_000; // sim time; at high time warp tracks refresh every frame
const MODELS: Record<StationId, () => StationModel> = { iss: buildIss, tiangong: buildTiangong };

type Sat = { id: StationId; satrec: SatRec; omm: OMMJsonObject };

function addStations(scene: GlobeScene | null, sats: Sat[]) {
  for (const s of sats) {
    scene?.addStation(s.id, STATION_STYLE[s.id].short, STATION_STYLE[s.id].color, MODELS[s.id]());
  }
}

/** Owns the three.js scene; drives propagation from the store's element sets and the sim clock. */
export function Globe() {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GlobeScene | null>(null);
  const stations = useLiveSky((s) => s.stations.env);
  const oem = useLiveSky((s) => s.oem.env);
  const view = useLiveSky((s) => s.view);
  const showTracks = useLiveSky((s) => s.showTracks);
  const showLabels = useLiveSky((s) => s.showLabels);

  // Latest inputs for the frame loop, kept in refs so the loop never re-subscribes.
  const sats = useRef<Sat[]>([]);
  const oemSegments = useRef<OemSegment[]>([]);
  const tracksDirty = useRef(true);
  useEffect(() => {
    oemSegments.current = oem?.data.segments ?? [];
  }, [oem]);

  useEffect(() => {
    sats.current = (stations?.data ?? []).map((s) => ({
      id: s.id,
      satrec: satrecFromOmm(s.omm),
      omm: s.omm,
    }));
    tracksDirty.current = true;
    addStations(sceneRef.current, sats.current);
    // A station missing from a newer payload must not stay frozen at its last position.
    sceneRef.current?.retainStations(new Set(sats.current.map((s) => s.id)));
  }, [stations]);

  useEffect(() => {
    const scene = new GlobeScene(host.current!);
    sceneRef.current = scene;
    sceneBus.scene = scene;
    addStations(scene, sats.current);
    let lastHud = 0;
    let lastTrackSim = 0;
    let lastSun = Number.NaN;

    scene.onSelect = (id) => useLiveSky.getState().setView(id as StationId);
    scene.onFrame = () => {
      const real = Date.now();
      const t = simNow(useLiveSky.getState().clock, real);
      const now = new Date(t);
      if (!(Math.abs(t - lastSun) < 1000)) {
        lastSun = t;
        scene.setSunEcef(sunDirectionEcef(now));
      }
      const redoTracks =
        sats.current.length > 0 && (tracksDirty.current || Math.abs(t - lastTrackSim) > TRACK_EVERY_SIM_MS);
      const doHud = real - lastHud > HUD_EVERY_MS;
      const live: Partial<Record<StationId, StationLive>> = {};
      for (const s of sats.current) {
        // SGP4 allocates a small result object per call; with two stations that is negligible.
        // The satellite swarm (M3) must propagate in a worker into a typed array instead.
        const st = propagateSat(s.satrec, now);
        scene.setStationState(s.id, st?.posEcefKm ?? null, st?.velDirEcef ?? null);
        if (doHud) {
          live[s.id] = {
            state: st,
            oemState: s.id === "iss" ? oemStateAt(oemSegments.current, now) : null,
            elementAgeH: elementAgeHours(s.omm, now),
            sunlit: scene.isSunlit(s.id),
          };
        }
        if (redoTracks) {
          const pts = [];
          for (let i = 0; i < TRACK_POINTS; i++) {
            pts.push(propagateSat(s.satrec, new Date(t + (i - 45) * 60_000))?.posEcefKm ?? null);
          }
          scene.setTrack(s.id, pts);
        }
      }
      if (redoTracks) {
        lastTrackSim = t;
        tracksDirty.current = false;
      }
      if (doHud) {
        lastHud = real;
        useLiveSky.getState().setLive(live);
      }
    };
    scene.start();
    return () => {
      scene.dispose();
      sceneRef.current = null;
      if (sceneBus.scene === scene) sceneBus.scene = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setView(view);
    // A station view can't start before the station has a position; retry briefly.
    if (scene.getView() === view) return;
    const id = window.setInterval(() => {
      scene.setView(view);
      if (scene.getView() === view) clearInterval(id);
    }, 200);
    return () => clearInterval(id);
  }, [view]);
  useEffect(() => sceneRef.current?.setTracksVisible(showTracks), [showTracks]);
  useEffect(() => sceneRef.current?.setLabelsVisible(showLabels), [showLabels]);

  return <div ref={host} className="globe" aria-label="3D view of Earth and live space station positions" />;
}
