/**
 * Simulation clock: sim time = anchorSim + (real - anchorReal) * rate, frozen while paused.
 * Every change re-anchors at the current instant, so sim time never jumps unless asked to.
 */
export type SimClock = { anchorReal: number; anchorSim: number; rate: number; paused: boolean };

export const TIME_RATES = [1, 10, 60, 600, 3600] as const;

export const liveClock = (realNow: number): SimClock => ({
  anchorReal: realNow,
  anchorSim: realNow,
  rate: 1,
  paused: false,
});

export function simNow(c: SimClock, realNow: number): number {
  return c.paused ? c.anchorSim : c.anchorSim + (realNow - c.anchorReal) * c.rate;
}

const reanchor = (c: SimClock, realNow: number): SimClock => ({
  ...c,
  anchorReal: realNow,
  anchorSim: simNow(c, realNow),
});

export const setRate = (c: SimClock, rate: number, realNow: number): SimClock => ({
  ...reanchor(c, realNow),
  rate,
});

export const setPaused = (c: SimClock, paused: boolean, realNow: number): SimClock => ({
  ...reanchor(c, realNow),
  paused,
});

export const jumpBy = (c: SimClock, deltaMs: number, realNow: number): SimClock => {
  const r = reanchor(c, realNow);
  return { ...r, anchorSim: r.anchorSim + deltaMs };
};

/** Next faster/slower preset rate (direction +1 or -1). */
export function stepRate(rate: number, direction: 1 | -1): number {
  const i = TIME_RATES.findIndex((r) => r >= rate);
  const idx = i === -1 ? TIME_RATES.length - 1 : i;
  const next = Math.min(Math.max(idx + direction, 0), TIME_RATES.length - 1);
  return TIME_RATES[next]!;
}

/** True when the sim is effectively showing the real present. */
export const isLive = (c: SimClock, realNow: number): boolean =>
  !c.paused && c.rate === 1 && Math.abs(simNow(c, realNow) - realNow) < 2000;

export function formatOffset(ms: number): string {
  const sign = ms < 0 ? "−" : "+";
  let s = Math.round(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d) return `${sign}${d}d ${h}h`;
  if (h) return `${sign}${h}h ${m}m`;
  if (m) return `${sign}${m}m ${s - m * 60}s`;
  return `${sign}${s}s`;
}
