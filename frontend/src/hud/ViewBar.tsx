import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { endFlight, spawnShip } from "../scene/flightLink";
import { sceneBus } from "../scene/sceneBus";
import { SPAWNS } from "../sim/flight";
import { useLiveSky, type ViewMode } from "../store/liveSky";
import { STATION_STYLE } from "./stationStyle";

const VIEW_COLORS: Partial<Record<ViewMode, string>> = {
  iss: STATION_STYLE.iss.color,
  tiangong: STATION_STYLE.tiangong.color,
  ship: "#7cff9b",
  free: "#c3a6ff",
};

/** Camera mode, flight, layer toggles. */
export function ViewBar() {
  const s = useLiveSky(
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
      shipActive: s.shipActive,
      flyMenu: s.flyMenu,
      setFlyMenu: s.setFlyMenu,
    })),
  );
  const [layersOpen, setLayersOpen] = useState(false);
  const views: { id: ViewMode; label: string; key: string; title: string }[] = [
    { id: "earth", label: "Earth", key: "0", title: "Orbit the Earth" },
    { id: "iss", label: "ISS", key: "1", title: "Fly alongside the ISS" },
    { id: "tiangong", label: "Tiangong", key: "2", title: "Fly alongside Tiangong" },
    ...(s.shipActive ? [{ id: "ship" as ViewMode, label: "Ship", key: "3", title: "Pilot your ship" }] : []),
    { id: "free", label: "Free", key: "4", title: "Free camera: WASD + mouse to fly anywhere" },
  ];

  return (
    <div className="viewbar">
      <div className="seg" role="radiogroup" aria-label="Camera">
        {views.map((v) => (
          <button
            key={v.id}
            role="radio"
            aria-checked={s.view === v.id}
            className={`seg-btn${s.view === v.id ? " on" : ""}`}
            style={VIEW_COLORS[v.id] ? ({ "--c": VIEW_COLORS[v.id] } as React.CSSProperties) : undefined}
            onClick={() => s.setView(v.id)}
            title={`${v.title} (${v.key})`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="popover-anchor">
        <button
          className="btn-ghost btn-fly"
          onClick={() => s.setFlyMenu(!s.flyMenu)}
          aria-expanded={s.flyMenu}
          title="Spawn and pilot your own spacecraft"
        >
          ✈ Fly
        </button>
        {s.flyMenu && (
          <div className="popover" role="menu">
            <h3>Spawn Rinkai-1</h3>
            {SPAWNS.map((sp) => (
              <button key={sp.id} role="menuitem" className="menu-item" onClick={() => spawnShip(sp.id)}>
                <strong>{sp.label}</strong>
                <span>{sp.hint}</span>
              </button>
            ))}
            {s.shipActive && (
              <button
                className="menu-item danger"
                onClick={() => {
                  endFlight();
                  s.setFlyMenu(false);
                }}
              >
                <strong>End flight</strong>
                <span>Remove your ship</span>
              </button>
            )}
          </div>
        )}
      </div>

      <div className="popover-anchor">
        <button className="btn-ghost" onClick={() => setLayersOpen(!layersOpen)} aria-expanded={layersOpen}>
          Layers ▾
        </button>
        {layersOpen && (
          <div className="popover layers" onMouseLeave={() => setLayersOpen(false)}>
            {(
              [
                ["Satellites", s.layers.satellites, () => s.toggleLayer("satellites"), "V"],
                ["Real clouds", s.layers.clouds, () => s.toggleLayer("clouds"), "C"],
                ["Stars", s.layers.stars, () => s.toggleLayer("stars"), "B"],
                ["Ground tracks", s.showTracks, s.toggleTracks, "T"],
                ["Labels", s.showLabels, s.toggleLabels, "N"],
              ] as const
            ).map(([label, on, toggle, key]) => (
              <label key={label}>
                <input type="checkbox" checked={on} onChange={toggle} /> {label} <kbd>{key}</kbd>
              </label>
            ))}
          </div>
        )}
      </div>

      <button className="btn-ghost" onClick={() => sceneBus.scene?.resetView()} title="Reset camera">
        Reset
      </button>
      <button
        className="btn-ghost btn-help"
        onClick={() => s.setHelp(true)}
        title="Controls (?)"
        aria-label="Controls help"
      >
        ?
      </button>
    </div>
  );
}
