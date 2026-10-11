import { useEffect } from "react";
import { sceneBus } from "../scene/sceneBus";
import { flight } from "../sim/flight";
import { input } from "../sim/input";
import { useLiveSky } from "../store/liveSky";

// Keys consumed as held controls in each mode (never treated as shortcuts there).
const FLIGHT_KEYS = new Set("w a s d q e i j k l h n shift control".split(" "));
const FREE_KEYS = new Set("w a s d r f arrowup arrowdown arrowleft arrowright shift".split(" "));

const STEP = Math.PI / 24; // 7.5 degrees per key press

export const SHORTCUTS: [string, string][] = [
  ["Drag (left or right button)", "Rotate the view"],
  ["Scroll / pinch", "Zoom"],
  ["W A S D / arrow keys", "Rotate the view"],
  ["Q / E  or  − / +", "Zoom out / in"],
  ["0 / 1 / 2", "Earth view / fly with ISS / fly with Tiangong"],
  ["Esc", "Back to Earth view (or close this panel)"],
  ["R", "Reset camera"],
  ["Space", "Pause / resume time"],
  ["[  /  ]", "Slower / faster time"],
  [",  /  .", "Jump back / forward 1 hour"],
  ["L", "Go live (real time, now)"],
  ["T / N", "Toggle ground tracks / labels"],
  ["V / C / B", "Toggle satellites / real clouds / stars"],
  ["Click a dot", "Inspect a satellite and draw its orbit"],
  ["3 / 4", "Pilot your ship / free camera"],
  ["Ship: Shift / Ctrl, Z / X", "Throttle up / down, full / cut"],
  ["Ship: W S · A D · Q E", "Pitch · yaw · roll"],
  ["Ship: I K · J L · H N", "RCS forward/back · left/right · up/down"],
  ["Ship: F · P · O · Y", "SAS hold / prograde / retrograde / target"],
  ["Free cam: WASD, R / F, drag, wheel", "Move, up / down, look, speed"],
  ["?", "Show this help"],
];

export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        if (e.key === "Escape") t.blur();
        return;
      }
      const s = useLiveSky.getState();
      const scene = sceneBus.scene;
      const k = e.key;
      const lk = k.toLowerCase();
      input.press(lk);
      // Held controls for the current mode.
      if (s.view === "ship" && s.shipActive && FLIGHT_KEYS.has(lk)) {
        e.preventDefault();
        return;
      }
      if (s.view === "free" && FREE_KEYS.has(lk)) {
        e.preventDefault();
        return;
      }
      // Discrete flight commands.
      const ship = flight.ship;
      if (s.view === "ship" && ship) {
        const flightCmd: Record<string, () => void> = {
          z: () => (ship.throttle = 1),
          x: () => (ship.throttle = 0),
          f: () => (ship.sas = ship.sas === "stability" ? "off" : "stability"),
          p: () => (ship.sas = "prograde"),
          o: () => (ship.sas = "retrograde"),
          y: () => (ship.sas = "target"),
        };
        if (flightCmd[lk]) {
          flightCmd[lk]!();
          e.preventDefault();
          return;
        }
      }
      let handled = true;
      switch (k) {
        case "a":
        case "ArrowLeft":
          scene?.rotateBy(STEP, 0);
          break;
        case "d":
        case "ArrowRight":
          scene?.rotateBy(-STEP, 0);
          break;
        case "w":
        case "ArrowUp":
          scene?.rotateBy(0, STEP);
          break;
        case "s":
        case "ArrowDown":
          scene?.rotateBy(0, -STEP);
          break;
        case "e":
        case "+":
        case "=":
          scene?.zoomBy(0.7);
          break;
        case "q":
        case "-":
          scene?.zoomBy(1 / 0.7);
          break;
        case "0":
          s.setView("earth");
          break;
        case "1":
          s.setView("iss");
          break;
        case "2":
          s.setView("tiangong");
          break;
        case "3":
          if (s.shipActive) s.setView("ship");
          break;
        case "4":
          s.setView("free");
          break;
        case "Escape":
          if (s.helpOpen) s.setHelp(false);
          else if (s.selectedSat !== null) s.selectSat(null);
          else s.setView("earth");
          break;
        case "v":
          s.toggleLayer("satellites");
          break;
        case "c":
          s.toggleLayer("clouds");
          break;
        case "b":
          s.toggleLayer("stars");
          break;
        case "r":
          scene?.resetView();
          break;
        case " ":
          s.togglePause();
          break;
        case "[":
          s.stepTimeRate(-1);
          break;
        case "]":
          s.stepTimeRate(1);
          break;
        case ",":
          s.jumpTime(-3600_000);
          break;
        case ".":
          s.jumpTime(3600_000);
          break;
        case "l":
          s.goLive();
          break;
        case "t":
          s.toggleTracks();
          break;
        case "n":
          s.toggleLabels();
          break;
        case "?":
          s.setHelp(!s.helpOpen);
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
    };
    const onUp = (e: KeyboardEvent) => input.release(e.key.toLowerCase());
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
    };
  }, []);
}
