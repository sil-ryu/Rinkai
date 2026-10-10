import type { StationId } from "../data/api";

// Colour-blind-safe pair (cyan / amber); every use also carries a text label.
export const STATION_STYLE: Record<StationId, { short: string; color: string }> = {
  iss: { short: "ISS", color: "#4cc9f0" },
  tiangong: { short: "Tiangong", color: "#ffb703" },
};

// Neutral, distinct hues per agency; the abbreviation is always shown, colour is secondary.
const AGENCY_COLORS: Record<string, string> = {
  NASA: "#7aa2ff",
  CNSA: "#ff8a7a",
  RFSA: "#c3a6ff",
  ESA: "#5ed6c1",
  JAXA: "#ffd166",
  CSA: "#f4a3c4",
  ISRO: "#ffad5c",
};

export const agencyColor = (abbrev: string | null): string => (abbrev && AGENCY_COLORS[abbrev]) || "#9aa7b8";

/** LL2 uses "RFSA" for Roscosmos; show the common name alongside. */
export const agencyLabel = (abbrev: string | null): string =>
  abbrev === "RFSA" ? "Roscosmos" : (abbrev ?? "Unknown");
