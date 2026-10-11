/** Display metadata for satellite categories and owner groups (colour is never the only cue). */
export const SAT_CATEGORIES = [
  { id: "starlink", label: "Starlink", color: "#c9d3e3" },
  { id: "oneweb", label: "OneWeb", color: "#c3a6ff" },
  { id: "broadband", label: "Other broadband", color: "#f4a3c4" },
  { id: "navigation", label: "Navigation", color: "#ffd166" },
  { id: "earth", label: "Earth obs & weather", color: "#5ed6c1" },
  { id: "comms", label: "Communications", color: "#ff8a5c" },
  { id: "science", label: "Science", color: "#7aa2ff" },
  { id: "station", label: "Crew & cargo", color: "#4cc9f0" },
  { id: "other", label: "Other", color: "#8a96a8" },
] as const;

export type SatCategory = (typeof SAT_CATEGORIES)[number]["id"];

export const OWNER_GROUPS = [
  "US",
  "China",
  "Russia",
  "Europe",
  "Japan",
  "India",
  "Other",
  "Unknown",
] as const;
export type OwnerGroup = (typeof OWNER_GROUPS)[number];

const EUROPE = new Set(
  "AT BE BG CH CY CZ DE DK EE ES FI FR GB GR HR HU IE IT LT LU LV MT NL NO PL PT RO SE SI SK ESA EU".split(
    " ",
  ),
);

/** Map a SatNOGS-style country list ("US,RU") to a display owner group (first country wins). */
export function ownerGroup(cc: string): OwnerGroup {
  const first = cc.split(",")[0]?.trim().toUpperCase() ?? "";
  if (!first) return "Unknown";
  if (first === "US") return "US";
  if (first === "CN") return "China";
  if (first === "RU") return "Russia";
  if (first === "JP") return "Japan";
  if (first === "IN") return "India";
  if (EUROPE.has(first)) return "Europe";
  return "Other";
}

export const categoryColor = (id: string): string =>
  SAT_CATEGORIES.find((c) => c.id === id)?.color ?? "#8a96a8";
export const categoryLabel = (id: string): string => SAT_CATEGORIES.find((c) => c.id === id)?.label ?? id;
