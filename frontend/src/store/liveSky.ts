import { create } from "zustand";
import type { Envelope, IssNow, OemWindow, StationCrew, StationId, TrackedStation } from "../data/api";
import type { SatState } from "../physics/sgp4";
import { jumpBy, liveClock, setPaused, setRate, stepRate, type SimClock } from "../sim/clock";

export type Feed<T> = { env: Envelope<T> | null; error: string | null; loading: boolean };

const emptyFeed = <T>(): Feed<T> => ({ env: null, error: null, loading: true });

export type StationLive = {
  state: SatState | null;
  /** NASA predicted ephemeris at the same instant, for the ISS only. */
  oemState: SatState | null;
  elementAgeH: number | null;
  sunlit: boolean | null;
};

/** "earth" orbits the planet; a station id flies alongside that station in its orbital frame. */
export type ViewMode = "earth" | StationId;

type FeedKey = "stations" | "crew" | "oem" | "issNow";

type LiveSkyState = {
  stations: Feed<TrackedStation[]>;
  crew: Feed<StationCrew[]>;
  oem: Feed<OemWindow>;
  issNow: Feed<IssNow>;
  live: Partial<Record<StationId, StationLive>>;
  view: ViewMode;
  showTracks: boolean;
  showLabels: boolean;
  helpOpen: boolean;
  clock: SimClock;
  setFeed: <K extends FeedKey>(key: K, feed: Partial<LiveSkyState[K]>) => void;
  setLive: (live: Partial<Record<StationId, StationLive>>) => void;
  setView: (view: ViewMode) => void;
  toggleTracks: () => void;
  toggleLabels: () => void;
  setHelp: (open: boolean) => void;
  togglePause: () => void;
  setTimeRate: (rate: number) => void;
  stepTimeRate: (dir: 1 | -1) => void;
  jumpTime: (deltaMs: number) => void;
  goLive: () => void;
};

export const useLiveSky = create<LiveSkyState>((set) => ({
  stations: emptyFeed(),
  crew: emptyFeed(),
  oem: emptyFeed(),
  issNow: emptyFeed(),
  live: {},
  view: "earth",
  showTracks: true,
  showLabels: true,
  helpOpen: false,
  clock: liveClock(Date.now()),
  setFeed: (key, feed) => set((s) => ({ [key]: { ...s[key], ...feed } }) as Partial<LiveSkyState>),
  setLive: (live) => set({ live }),
  setView: (view) => set({ view }),
  toggleTracks: () => set((s) => ({ showTracks: !s.showTracks })),
  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),
  setHelp: (helpOpen) => set({ helpOpen }),
  togglePause: () => set((s) => ({ clock: setPaused(s.clock, !s.clock.paused, Date.now()) })),
  setTimeRate: (rate) =>
    set((s) => ({ clock: setPaused(setRate(s.clock, rate, Date.now()), false, Date.now()) })),
  stepTimeRate: (dir) => set((s) => ({ clock: setRate(s.clock, stepRate(s.clock.rate, dir), Date.now()) })),
  jumpTime: (deltaMs) => set((s) => ({ clock: jumpBy(s.clock, deltaMs, Date.now()) })),
  goLive: () => set({ clock: liveClock(Date.now()) }),
}));
