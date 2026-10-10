import { useEffect, useRef } from "react";
import type { OMMJsonObject, SatRec } from "satellite.js";
import type { StationId } from "../data/api";
import { oemStateAt, type OemSegment } from "../physics/oem";
import { elementAgeHours, propagateSat, satrecFromOmm } from "../physics/sgp4";
import { sunDirectionEcef } from "../physics/sun";
import { useLiveSky, type StationLive } from "../store/liveSky";
import { STATION_STYLE } from "../hud/stationStyle";
import { GlobeScene, TRACK_POINTS } from "./GlobeScene";

const HUD_EVERY_MS = 250;
const TRACK_EVERY_MS = 15_000;

/** Owns the three.js scene; drives propagation from the store's element sets. */
export function Globe() {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GlobeScene | null>(null);
  const stations = useLiveSky((s) => s.stations.env);
  const oem = useLiveSky((s) => s.oem.env);
  const focus = useLiveSky((s) => s.focus);
  const follow = useLiveSky((s) => s.follow);
  const showTracks = useLiveSky((s) => s.showTracks);

  // Latest inputs for the frame loop, kept in refs so the loop never re-subscribes.
  const sats = useRef<{ id: StationId; satrec: SatRec; omm: OMMJsonObject }[]>([]);
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
    const scene = sceneRef.current;
    for (const s of sats.current)
      scene?.addStation(s.id, STATION_STYLE[s.id].short, STATION_STYLE[s.id].color);
    // A station missing from a newer payload must not stay frozen at its last position.
    scene?.retainStations(new Set(sats.current.map((s) => s.id)));
  }, [stations]);

  useEffect(() => {
    const scene = new GlobeScene(host.current!);
    sceneRef.current = scene;
    for (const s of sats.current)
      scene.addStation(s.id, STATION_STYLE[s.id].short, STATION_STYLE[s.id].color);
    let lastHud = 0;
    let lastTrack = 0;

    scene.onUserMove = () => useLiveSky.getState().follow && useLiveSky.setState({ follow: false });
    scene.onSelect = (id) => useLiveSky.getState().setFocus(id as StationId);
    let lastSun = 0;
    scene.onFrame = (now) => {
      const t = now.getTime();
      // The Sun moves 0.004 deg/s: once a second is plenty.
      if (t - lastSun > 1000) {
        lastSun = t;
        scene.setSunEcef(sunDirectionEcef(now));
      }
      const redoTracks = sats.current.length > 0 && (tracksDirty.current || t - lastTrack > TRACK_EVERY_MS);
      const doHud = t - lastHud > HUD_EVERY_MS;
      const live: Partial<Record<StationId, StationLive>> = {};
      for (const s of sats.current) {
        // SGP4 allocates a small result object per call; with two stations that is negligible.
        // The satellite swarm (M3) must propagate in a worker into a typed array instead.
        const st = propagateSat(s.satrec, now);
        scene.setStationPosition(s.id, st?.posEcefKm ?? null);
        if (doHud) {
          live[s.id] = {
            state: st,
            oemState: s.id === "iss" ? oemStateAt(oemSegments.current, now) : null,
            elementAgeH: elementAgeHours(s.omm, now),
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
        lastTrack = t;
        tracksDirty.current = false;
      }
      if (doHud) {
        lastHud = t;
        useLiveSky.getState().setLive(live);
      }
    };
    scene.start();
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => sceneRef.current?.setFocus(focus, follow), [focus, follow]);
  useEffect(() => sceneRef.current?.setTracksVisible(showTracks), [showTracks]);

  return <div ref={host} className="globe" aria-label="3D globe showing live space station positions" />;
}
