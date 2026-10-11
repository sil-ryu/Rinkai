import { useShallow } from "zustand/react/shallow";
import { setFlightTarget } from "../scene/flightLink";
import { flight, fmtKm } from "../sim/flight";
import type { SasMode } from "../sim/ship";
import { useLiveSky } from "../store/liveSky";
import { useNow } from "./useNow";

const SAS: { id: SasMode; label: string; key?: string }[] = [
  { id: "stability", label: "Hold", key: "F" },
  { id: "prograde", label: "Prograde", key: "P" },
  { id: "retrograde", label: "Retro", key: "O" },
  { id: "normal", label: "Normal" },
  { id: "antinormal", label: "Anti-norm" },
  { id: "radialOut", label: "Radial out" },
  { id: "radialIn", label: "Radial in" },
  { id: "target", label: "Target", key: "Y" },
  { id: "antiTarget", label: "Anti-tgt" },
  { id: "off", label: "Free spin" },
];

const fmtSpeed = (kms: number) =>
  Math.abs(kms) < 1 ? `${(kms * 1000).toFixed(1)} m/s` : `${kms.toFixed(3)} km/s`;
const fmtTime = (s: number) => {
  if (s < 120) return `${s.toFixed(0)} s`;
  if (s < 7200) return `${(s / 60).toFixed(1)} min`;
  if (s < 172800) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(1)} d`;
};

/** Pilot's panel: orbit, engine, SAS, target. Replaces the crew panel while flying. */
export function FlightHud() {
  const { tel, targetId, sats, selectedSat } = useLiveSky(
    useShallow((s) => ({
      tel: s.telemetry,
      targetId: s.flightTarget,
      sats: s.satellites.env?.data.satellites,
      selectedSat: s.selectedSat,
    })),
  );
  const ship = flight.ship;
  if (!tel || !ship) return null;
  const selName = selectedSat !== null ? sats?.find((r) => r.id === selectedSat)?.name : undefined;

  return (
    <section className="panel panel-right flight" aria-label="Flight">
      <div className="panel-head">
        <h1>
          Rinkai-1 <span className={`status status-${tel.status}`}>{tel.status.toUpperCase()}</span>
        </h1>
      </div>

      {tel.impact && tel.status === "flying" && (
        <p className="alert">
          ⚠ Impact with the {tel.impact === "earth" ? "Earth" : "Moon"} in {fmtTime(tel.impactInS ?? 0)} —
          burn prograde / radial out
        </p>
      )}

      <dl className="readout">
        <div>
          <dt>Alt ({tel.refBody})</dt>
          <dd>{fmtKm(tel.altKm)}</dd>
        </div>
        <div>
          <dt>Speed</dt>
          <dd>{fmtSpeed(tel.speedKms)}</dd>
        </div>
        <div>
          <dt>Apoapsis</dt>
          <dd>{tel.apoAltKm === null ? "escape" : fmtKm(tel.apoAltKm)}</dd>
        </div>
        <div>
          <dt>Periapsis</dt>
          <dd className={tel.periAltKm < 0 ? "warn" : undefined}>{fmtKm(tel.periAltKm)}</dd>
        </div>
        <div>
          <dt>Period</dt>
          <dd>{tel.periodS ? fmtTime(tel.periodS) : "—"}</dd>
        </div>
        <div>
          <dt>Incl.</dt>
          <dd>{tel.incDeg.toFixed(2)}°</dd>
        </div>
      </dl>

      <div className="throttle" aria-label={`Throttle ${Math.round(tel.throttle * 100)}%`}>
        <span>Throttle</span>
        <div className="bar">
          <div style={{ width: `${tel.throttle * 100}%` }} />
        </div>
        <span className="pct">{Math.round(tel.throttle * 100)}%</span>
      </div>
      <p className="muted small">
        Δv used {fmtSpeed(tel.dvUsedKms)} · fuel{" "}
        {tel.fuelPct === null ? "∞ (sandbox)" : `${tel.fuelPct.toFixed(0)}%`}
        {" · "}
        <label className="inline">
          <input
            type="checkbox"
            checked={!ship.infiniteFuel}
            onChange={(e) => {
              ship.infiniteFuel = !e.target.checked;
            }}
          />{" "}
          real fuel
        </label>
      </p>

      <h2 className="sub">Attitude hold (SAS)</h2>
      <div className="sas-grid">
        {SAS.map((m) => (
          <button
            key={m.id}
            className={`sas-btn${tel.sas === m.id ? " on" : ""}`}
            disabled={(m.id === "target" || m.id === "antiTarget") && !tel.target}
            onClick={() => {
              ship.sas = m.id;
            }}
            title={m.key ? `Key ${m.key}` : undefined}
          >
            {m.label}
          </button>
        ))}
      </div>

      <h2 className="sub">Target</h2>
      <select
        className="search"
        value={targetId ?? ""}
        onChange={(e) => setFlightTarget(e.target.value || null)}
        aria-label="Rendezvous target"
      >
        <option value="">None</option>
        <option value="iss">ISS</option>
        <option value="tiangong">Tiangong</option>
        {selName && <option value={`sat:${selectedSat}`}>{selName} (selected)</option>}
      </select>
      {tel.target && (
        <dl className="readout">
          <div>
            <dt>Range</dt>
            <dd>{fmtKm(tel.target.rangeKm)}</dd>
          </div>
          <div>
            <dt>Rel. speed</dt>
            <dd>{fmtSpeed(tel.target.relSpeedKms)}</dd>
          </div>
          <div>
            <dt>Closing</dt>
            <dd className={tel.target.closingKms > 0.001 && tel.target.rangeKm < 0.2 ? "warn" : undefined}>
              {fmtSpeed(tel.target.closingKms)}
            </dd>
          </div>
          <div>
            <dt>Dock when</dt>
            <dd>{"< 30 m, < 0.5 m/s"}</dd>
          </div>
        </dl>
      )}

      <p className="muted small keys">
        <kbd>Shift</kbd>/<kbd>Ctrl</kbd> throttle · <kbd>Z</kbd> full · <kbd>X</kbd> cut · <kbd>W</kbd>
        <kbd>S</kbd> pitch · <kbd>A</kbd>
        <kbd>D</kbd> yaw · <kbd>Q</kbd>
        <kbd>E</kbd> roll · <kbd>I</kbd>
        <kbd>K</kbd> fwd/back · <kbd>J</kbd>
        <kbd>L</kbd> left/right · <kbd>H</kbd>
        <kbd>N</kbd> up/down
      </p>
    </section>
  );
}

/** Short-lived message line (docking, crashes, warp limits). */
export function Toast() {
  const now = useNow(500); // re-render so the toast disappears on time
  const toast = useLiveSky((s) => s.toast);
  if (!toast || now - toast.at > 4500) return null;
  return (
    <div key={toast.at} className={`toast toast-${toast.kind}`} role="status">
      {toast.text}
    </div>
  );
}
