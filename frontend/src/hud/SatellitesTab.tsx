import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { SatRecord } from "../data/api";
import {
  categoryColor,
  categoryLabel,
  ownerGroup,
  OWNER_GROUPS,
  SAT_CATEGORIES,
} from "../data/satCategories";
import { simNow } from "../sim/clock";
import { satDetails, satrecOf, visibilityMask } from "../sim/satellites";
import { useLiveSky } from "../store/liveSky";
import { DataBadge } from "./DataBadge";
import { useNow } from "./useNow";

const fmt = (n: number, d = 0) =>
  n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });

function SatCard({ rec }: { rec: SatRecord }) {
  const real = useNow(500);
  const clock = useLiveSky((s) => s.clock);
  const selectSat = useLiveSky((s) => s.selectSat);
  const satrec = useMemo(() => satrecOf(rec), [rec]);
  const d = satrec ? satDetails(satrec, new Date(simNow(clock, real))) : null;
  return (
    <article className="sat-card" style={{ "--c": categoryColor(rec.cat) } as React.CSSProperties}>
      <header>
        <h2>
          <span className="sat-dot" aria-hidden />
          {rec.name}
        </h2>
        <button className="btn-ghost" onClick={() => selectSat(null)} aria-label="Deselect satellite">
          ✕
        </button>
      </header>
      <p className="station-op">
        NORAD {rec.id} · {categoryLabel(rec.cat)} · {rec.orbit} ·{" "}
        {rec.cc ? rec.cc.replaceAll(",", ", ") : "owner unknown"}
      </p>
      {d ? (
        <dl className="readout">
          <div>
            <dt>Lat / Lon</dt>
            <dd>
              {fmt(d.latDeg, 1)}°, {fmt(d.lonDeg, 1)}°
            </dd>
          </div>
          <div>
            <dt>Alt</dt>
            <dd>{fmt(d.altKm)} km</dd>
          </div>
          <div>
            <dt>Speed</dt>
            <dd>{fmt(d.speedKmS * 3600)} km/h</dd>
          </div>
          <div>
            <dt>Period</dt>
            <dd>{d.periodMin < 200 ? `${fmt(d.periodMin, 1)} min` : `${fmt(d.periodMin / 60, 2)} h`}</dd>
          </div>
          <div>
            <dt>Incl.</dt>
            <dd>{fmt(d.inclDeg, 1)}°</dd>
          </div>
          <div>
            <dt>Perigee / apogee</dt>
            <dd>
              {fmt(d.perigeeKm)} / {fmt(d.apogeeKm)} km
            </dd>
          </div>
          <div>
            <dt>Light</dt>
            <dd className={d.sunlit ? undefined : "shadow"}>{d.sunlit ? "☀ Sunlit" : "◐ Earth shadow"}</dd>
          </div>
          <div>
            <dt>Elements</dt>
            <dd className={Math.abs(d.epochAgeH) > 72 ? "warn" : undefined}>
              {fmt(d.epochAgeH, 1)} h from epoch
            </dd>
          </div>
        </dl>
      ) : (
        <p className="muted">Propagation failed for this element set (decayed or invalid).</p>
      )}
    </article>
  );
}

export function SatellitesTab() {
  const { feed, filter, setFilter, selected, selectSat, layerOn, toggleLayer } = useLiveSky(
    useShallow((s) => ({
      feed: s.satellites,
      filter: s.satFilter,
      setFilter: s.setSatFilter,
      selected: s.selectedSat,
      selectSat: s.selectSat,
      layerOn: s.layers.satellites,
      toggleLayer: s.toggleLayer,
    })),
  );
  const recs = useMemo(() => feed.env?.data.satellites ?? [], [feed.env]);
  const mask = useMemo(() => visibilityMask(recs, filter), [recs, filter]);
  const shown = useMemo(() => mask.reduce((a, b) => a + b, 0), [mask]);
  const catCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of recs) m[r.cat] = (m[r.cat] ?? 0) + 1;
    return m;
  }, [recs]);
  const ownerCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of recs) m[ownerGroup(r.cc)] = (m[ownerGroup(r.cc)] ?? 0) + 1;
    return m;
  }, [recs]);
  const q = filter.query.trim();
  const matches = useMemo(() => (q ? recs.filter((_, i) => mask[i]).slice(0, 8) : []), [q, recs, mask]);
  const sel = selected === null ? null : recs.find((r) => r.id === selected);
  const setAll = (key: "cats" | "owners", on: boolean) =>
    setFilter({ [key]: Object.fromEntries(Object.keys(filter[key]).map((k) => [k, on])) });

  return (
    <div className="sat-tab">
      <div className="panel-head">
        <h1>
          Satellites <span className="count">{feed.env ? `${fmt(shown)} / ${fmt(recs.length)}` : "—"}</span>
        </h1>
        <DataBadge env={feed.env} error={feed.error} />
      </div>
      {feed.env && <p className="provider">Elements: {feed.env.provider}</p>}
      <label className="switch">
        <input type="checkbox" checked={layerOn} onChange={() => toggleLayer("satellites")} />
        Show satellites on the globe <kbd>V</kbd>
      </label>

      {sel && <SatCard rec={sel} />}

      <input
        className="search"
        type="search"
        placeholder="Search name or NORAD id…"
        value={filter.query}
        onChange={(e) => setFilter({ query: e.target.value })}
        aria-label="Search satellites"
      />
      {q && (
        <ul className="matches">
          {matches.length === 0 && <li className="muted">No match among the shown categories.</li>}
          {matches.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => selectSat(r.id)}
                style={{ "--c": categoryColor(r.cat) } as React.CSSProperties}
              >
                <span className="sat-dot" aria-hidden />
                {r.name} <span className="muted">#{r.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="filter-head">
        <h2>Categories</h2>
        <span>
          <button className="link" onClick={() => setAll("cats", true)}>
            all
          </button>{" "}
          ·{" "}
          <button className="link" onClick={() => setAll("cats", false)}>
            none
          </button>
        </span>
      </div>
      <ul className="cat-list">
        {SAT_CATEGORIES.filter((c) => catCount[c.id]).map((c) => (
          <li key={c.id}>
            <label style={{ "--c": c.color } as React.CSSProperties}>
              <input
                type="checkbox"
                checked={filter.cats[c.id] ?? true}
                onChange={(e) => setFilter({ cats: { ...filter.cats, [c.id]: e.target.checked } })}
              />
              <span className="sat-dot" aria-hidden />
              {c.label}
              <span className="n">{fmt(catCount[c.id] ?? 0)}</span>
            </label>
          </li>
        ))}
      </ul>

      <div className="filter-head">
        <h2>Owner</h2>
        <span>
          <button className="link" onClick={() => setAll("owners", true)}>
            all
          </button>
        </span>
      </div>
      <div className="owner-chips">
        {OWNER_GROUPS.filter((o) => ownerCount[o]).map((o) => (
          <button
            key={o}
            className={`chip-btn${filter.owners[o] ? " on" : ""}`}
            aria-pressed={!!filter.owners[o]}
            onClick={() => setFilter({ owners: { ...filter.owners, [o]: !filter.owners[o] } })}
          >
            {o} <span className="n">{fmt(ownerCount[o] ?? 0)}</span>
          </button>
        ))}
      </div>
      <p className="muted small">
        Categories are inferred from satellite names; owners from SatNOGS where known. Click any dot on the
        globe to inspect it. Dim dots are in Earth&apos;s shadow.
      </p>
    </div>
  );
}
