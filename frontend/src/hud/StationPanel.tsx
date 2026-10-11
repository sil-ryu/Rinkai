import type { TrackedStation } from "../data/api";
import { separationKm } from "../physics/frames";
import { useLiveSky } from "../store/liveSky";
import { DataBadge } from "./DataBadge";
import { SatellitesTab } from "./SatellitesTab";
import { STATION_STYLE } from "./stationStyle";

const fmtLat = (d: number) => `${Math.abs(d).toFixed(2)}° ${d >= 0 ? "N" : "S"}`;
const fmtLon = (d: number) => `${Math.abs(d).toFixed(2)}° ${d >= 0 ? "E" : "W"}`;
const STALE_ELEMENTS_H = 72;

function StationCard({ st }: { st: TrackedStation }) {
  const live = useLiveSky((s) => s.live[st.id]);
  const crewCount = useLiveSky((s) => s.crew.env?.data.find((g) => g.station_id === st.id)?.crew.length);
  const view = useLiveSky((s) => s.view);
  const setView = useLiveSky((s) => s.setView);
  const style = STATION_STYLE[st.id];
  const p = live?.state;
  const oemDelta = p && live?.oemState ? separationKm(p, live.oemState) : null;
  const viewing = view === st.id;
  const ageH = live?.elementAgeH ?? null;
  const stale = ageH !== null && Math.abs(ageH) > STALE_ELEMENTS_H;

  return (
    <article
      className={`station-card${viewing ? " focused" : ""}`}
      style={{ "--c": style.color } as React.CSSProperties}
    >
      <header>
        <h2>
          <span className="station-swatch" aria-hidden />
          {st.name}
        </h2>
        <button
          className="btn-ghost"
          onClick={() => setView(viewing ? "earth" : st.id)}
          aria-pressed={viewing}
          title={viewing ? "Back to Earth view (0)" : "Fly alongside in 3D"}
        >
          {viewing ? "Earth view" : "View 3D"}
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
            <dt>Light</dt>
            <dd className={live?.sunlit === false ? "shadow" : undefined}>
              {live?.sunlit === null || live?.sunlit === undefined
                ? "—"
                : live.sunlit
                  ? "☀ Sunlit"
                  : "◐ Earth shadow"}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="muted">Propagating…</p>
      )}
      <footer className="station-src">
        SGP4 from CelesTrak elements{" "}
        <span className={stale ? "warn" : undefined}>
          ({ageH === null ? "—" : `${ageH >= 0 ? "" : "−"}${Math.abs(ageH).toFixed(1)} h from epoch`})
        </span>
        {stale && <span className="warn"> · accuracy degrades this far from the element epoch</span>}
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
  const tab = useLiveSky((s) => s.leftTab);
  const setTab = useLiveSky((s) => s.setLeftTab);
  const stations = useLiveSky((s) => s.stations);
  return (
    <section className="panel panel-left" aria-label="Stations and satellites">
      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "stations"}
          className={tab === "stations" ? "on" : ""}
          onClick={() => setTab("stations")}
        >
          Stations
        </button>
        <button
          role="tab"
          aria-selected={tab === "satellites"}
          className={tab === "satellites" ? "on" : ""}
          onClick={() => setTab("satellites")}
        >
          Satellites
        </button>
      </div>
      {tab === "satellites" ? <SatellitesTab /> : <StationsTab stations={stations} />}
    </section>
  );
}

function StationsTab({ stations }: { stations: ReturnType<typeof useLiveSky.getState>["stations"] }) {
  return (
    <>
      <div className="panel-head">
        <h1>Crewed stations</h1>
        <DataBadge env={stations.env} error={stations.error} />
      </div>
      {stations.error && !stations.env && <p className="error">Orbit data unavailable: {stations.error}</p>}
      {stations.env?.data.map((st) => (
        <StationCard key={st.id} st={st} />
      ))}
    </>
  );
}
