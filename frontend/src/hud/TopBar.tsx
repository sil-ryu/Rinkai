import { useShallow } from "zustand/react/shallow";
import { useLiveSky } from "../store/liveSky";
import { DataBadge } from "./DataBadge";

export function TopBar() {
  const { stations, crew, oem, issNow, satellites, earthDaily } = useLiveSky(
    useShallow((s) => ({
      stations: s.stations,
      crew: s.crew,
      oem: s.oem,
      issNow: s.issNow,
      satellites: s.satellites,
      earthDaily: s.earthDaily,
    })),
  );
  const feeds = [
    ["Orbits", stations],
    ["Crew", crew],
    ["NASA ephemeris", oem],
    ["ISS fix", issNow],
    ["Satellites", satellites],
    [earthDaily.env ? `Clouds ${earthDaily.env.data.date.slice(5)}` : "Clouds", earthDaily],
  ] as const;
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-name">RINKAI</span>
        <span className="brand-kanji" lang="ja">
          臨界
        </span>
        <span className="brand-mode">LIVE SKY</span>
      </div>
      <ul className="feeds" aria-label="Data freshness">
        {feeds.map(([name, f]) => (
          <li key={name}>
            <span className="feed-name">{name}</span>
            <DataBadge env={f.env} error={f.error} compact />
          </li>
        ))}
      </ul>
    </header>
  );
}
