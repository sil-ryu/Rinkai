import { useLiveSky } from "../store/liveSky";
import { DataBadge } from "./DataBadge";
import { agencyColor, agencyLabel, STATION_STYLE } from "./stationStyle";

export function CrewPanel() {
  const crew = useLiveSky((s) => s.crew);
  const groups = crew.env?.data ?? [];
  const total = groups.reduce((n, g) => n + g.crew.length, 0);
  const agencies = [...new Set(groups.flatMap((g) => g.crew.map((c) => c.agency)))];

  return (
    <section className="panel panel-right" aria-label="People in space">
      <div className="panel-head">
        <h1>
          In space now <span className="count">{crew.env ? total : "—"}</span>
        </h1>
        <DataBadge env={crew.env} error={crew.error} />
      </div>
      {crew.error && !crew.env && <p className="error">Crew data unavailable: {crew.error}</p>}
      {agencies.length > 0 && (
        <p className="agency-summary">
          {agencies.length} agencies:{" "}
          {agencies.map((a) => (
            <span key={a ?? "?"} className="chip" style={{ "--a": agencyColor(a) } as React.CSSProperties}>
              {agencyLabel(a)}
            </span>
          ))}
        </p>
      )}
      {groups.map((g) => {
        const style = g.station_id ? STATION_STYLE[g.station_id] : null;
        return (
          <div
            key={`${g.station}-${g.expedition}`}
            className="crew-group"
            style={{ "--c": style?.color ?? "#9aa7b8" } as React.CSSProperties}
          >
            <h2>
              <span className="station-swatch" aria-hidden />
              {g.station ?? "Unknown station"}
              <span className="expedition">{g.expedition}</span>
            </h2>
            <ul>
              {g.crew.map((c) => (
                <li key={c.name}>
                  <span className="crew-name">{c.name}</span>
                  <span className="crew-meta">
                    {c.role && <span className="crew-role">{c.role}</span>}
                    <span
                      className="chip"
                      style={{ "--a": agencyColor(c.agency) } as React.CSSProperties}
                      title={c.agency_name ?? undefined}
                    >
                      {agencyLabel(c.agency)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
