import type { GlobeScene } from "./GlobeScene";

/** Handle for imperative camera commands (keyboard shortcuts, HUD buttons). Set by <Globe />. */
export const sceneBus: { scene: GlobeScene | null } = { scene: null };
