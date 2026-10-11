import { useEffect } from "react";
import { sceneBus } from "../scene/sceneBus";
import { useLiveSky } from "../store/liveSky";

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
  ["?", "Show this help"],
];

export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const s = useLiveSky.getState();
      const scene = sceneBus.scene;
      const k = e.key;
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
        case "Escape":
          if (s.helpOpen) s.setHelp(false);
          else s.setView("earth");
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
