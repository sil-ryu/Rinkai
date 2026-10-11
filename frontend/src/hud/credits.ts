/** Credits for bundled (non-API) assets; API data credits come from each response envelope. */
export const STATIC_CREDITS = [
  "Earth imagery: NASA Blue Marble and Black Marble via NASA EOSDIS GIBS.",
  "Stars: Yale Bright Star Catalogue (Hoffleit & Warren 1991, via CDS VizieR V/50) and ESA Gaia DR3 (ESA/Gaia/DPAC, CC BY-SA 3.0 IGO).",
  "Moon map: Clementine global mosaic, Naval Research Laboratory (public domain).",
];

/** Short provider name for the always-visible credit line. */
export function shortProvider(provider: string): string {
  if (provider.startsWith("SatNOGS")) return "SatNOGS DB (CC BY-SA 4.0)";
  if (provider.startsWith("NASA JSC")) return "NASA JSC";
  if (provider.startsWith("NASA EOSDIS GIBS")) return "NASA GIBS/VIIRS";
  if (provider.startsWith("Launch Library 2")) return "Launch Library 2";
  return provider;
}
