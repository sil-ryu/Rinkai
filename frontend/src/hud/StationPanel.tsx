import type { StationId, TrackedStation } from "../data/api";
import { separationKm } from "../physics/frames";
import { useLiveSky } from "../store/liveSky";
import { DataBadge } from "./DataBadge";
import { STATION_STYLE } from "./stationStyle";

const fmtLat = (d: number) => `${Math.abs(d).toFixed(2)}° ${d >= 0 ? "N" : "S"}`;
const fmtLon = (d: number) => `${Math.abs(d).toFixed(2)}° ${d >= 0 ? "E" : "W"}`;

function StationCard({ st }: { st: TrackedStation }) {
  const live = useLiveSky((s) => s.live[st.id]);
  const crewCount = useLiveSky((s) => s.crew.env?.data.find((g) => g.station_id === st.id)?.crew.length);
  const focus = useLiveSky((s) => s.focus);
  const setFocus = useLiveSky((s) => s.setFocus);
  const style = STATION_STYLE[st.id];
  const p = live?.state;
  const oemDelta = p && live?.oemState ? separationKm(p, live.oemState) : null;
  const focused = focus === st.id;

  return (
    <article
      className={`station-card${focused ? " focused" : ""}`}
      style={{ "--c": style.color } as React.CSSProperties}
    >
      <header>
        <h2>
          <span className="station-swatch" aria-hidden />
          {st.name}
        </h2>
        <button
          className="btn-ghost"
          onClick={() => setFocus(focused ? null : (st.id as StationId))}
          aria-pressed={focused}
        >
          {focused ? "Release" : "Follow"}
        </button>
      </header>
      <p className="station-op">{st.operator}</p>
      {p ? (
        <dl className="readout">
          <div>
            <dt>Lat</dt>
            <dd>{fmtLat(p.latDeg)}</dd>
          </div>
          <div>
            <dt>Lon</dt>
            <dd>{fmtLon(p.lonDeg)}</dd>
          </div>
          <div>
            <dt>Alt</dt>
            <dd>{p.altKm.toFixed(1)} km</dd>
          </div>
          <div>
            <dt>Speed</dt>
            <dd>{(p.speedKmS * 3600).toLocaleString("en-US", { maximumFractionDigits: 0 })} km/h</dd>
          </div>
          <div>
            <dt>Crew</dt>
            <dd>{crewCount ?? "—"}</dd>
          </div>
          <div>
            <dt>Elements</dt>
            <dd className={live && live.elementAgeH! > 48 ? "warn" : undefined}>
              {live?.elementAgeH?.toFixed(1)} h old
            </dd>
          </div>
        </dl>
      ) : (
        <p className="muted">Propagating…</p>
      )}
      <footer className="station-src">
        Position: SGP4 from CelesTrak elements
        {oemDelta !== null && (
          <span title="Distance between the SGP4 position and NASA's predicted ISS ephemeris at this instant. NASA's file is a forecast issued every few days, so it drifts along-track.">
            {" "}
            · NASA forecast Δ {oemDelta.toFixed(1)} km
          </span>
        )}
      </footer>
    </article>
  );
}

export function StationPanel() {
  const stations = useLiveSky((s) => s.stations);
  return (
    <section className="panel panel-left" aria-label="Crewed stations">
      <div className="panel-head">
        <h1>Crewed stations</h1>
        <DataBadge env={stations.env} error={stations.error} />
      </div>
      {stations.error && !stations.env && <p className="error">Orbit data unavailable: {stations.error}</p>}
      {stations.env?.data.map((st) => (
        <StationCard key={st.id} st={st} />
      ))}
    </section>
  );
}
