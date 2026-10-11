import { useShallow } from "zustand/react/shallow";
import { sceneBus } from "../scene/sceneBus";
import { useLiveSky, type ViewMode } from "../store/liveSky";
import { STATION_STYLE } from "./stationStyle";

const VIEWS: { id: ViewMode; label: string; key: string }[] = [
  { id: "earth", label: "Earth", key: "0" },
  { id: "iss", label: STATION_STYLE.iss.short, key: "1" },
  { id: "tiangong", label: STATION_STYLE.tiangong.short, key: "2" },
];

/** Camera mode and layer toggles. */
export function ViewBar() {
  const { view, setView, showTracks, toggleTracks, showLabels, toggleLabels, setHelp, layers, toggleLayer } =
    useLiveSky(
      useShallow((s) => ({
        view: s.view,
        setView: s.setView,
        showTracks: s.showTracks,
        toggleTracks: s.toggleTracks,
        showLabels: s.showLabels,
        toggleLabels: s.toggleLabels,
        setHelp: s.setHelp,
        layers: s.layers,
        toggleLayer: s.toggleLayer,
      })),
    );
  return (
    <div className="viewbar">
      <div className="seg" role="radiogroup" aria-label="Camera">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="radio"
            aria-checked={view === v.id}
            className={`seg-btn${view === v.id ? " on" : ""}`}
            style={
              v.id !== "earth" ? ({ "--c": STATION_STYLE[v.id].color } as React.CSSProperties) : undefined
            }
            onClick={() => setView(v.id)}
            title={`${v.id === "earth" ? "Orbit the Earth" : `Fly alongside the ${v.label}`} (${v.key})`}
          >
            {v.label}
          </button>
        ))}
      </div>
      <button className="btn-ghost" onClick={() => sceneBus.scene?.resetView()} title="Reset camera (R)">
        Reset
      </button>
      <button
        className="btn-ghost"
        onClick={toggleTracks}
        aria-pressed={showTracks}
        title="Ground tracks (T)"
      >
        Tracks
      </button>
      <button className="btn-ghost" onClick={toggleLabels} aria-pressed={showLabels} title="Labels (N)">
        Labels
      </button>
      <button
        className="btn-ghost"
        onClick={() => toggleLayer("satellites")}
        aria-pressed={layers.satellites}
        title="All satellites (V)"
      >
        Sats
      </button>
      <button
        className="btn-ghost"
        onClick={() => toggleLayer("clouds")}
        aria-pressed={layers.clouds}
        title="Real clouds from yesterday's VIIRS imagery (C)"
      >
        Clouds
      </button>
      <button
        className="btn-ghost"
        onClick={() => toggleLayer("stars")}
        aria-pressed={layers.stars}
        title="Star field (B)"
      >
        Stars
      </button>
      <button
        className="btn-ghost btn-help"
        onClick={() => setHelp(true)}
        title="Controls (?)"
        aria-label="Controls help"
      >
        ?
      </button>
    </div>
  );
}
