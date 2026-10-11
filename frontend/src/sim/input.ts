/**
 * Held-key state for continuous controls (flying the ship, free camera). Discrete shortcuts stay in
 * useKeyboard; this only records which keys are down right now.
 */
const held = new Set<string>();

export const input = {
  isDown: (k: string) => held.has(k.toLowerCase()),
  axis: (neg: string, pos: string) => (held.has(pos) ? 1 : 0) - (held.has(neg) ? 1 : 0),
  press: (k: string) => held.add(k.toLowerCase()),
  release: (k: string) => held.delete(k.toLowerCase()),
  clear: () => held.clear(),
};

if (typeof window !== "undefined") {
  window.addEventListener("blur", () => held.clear()); // never leave a key "stuck" after alt-tab
}
