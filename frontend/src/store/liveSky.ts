import { create } from "zustand";
import type {
  EarthDaily,
  Envelope,
  IssNow,
  OemWindow,
  SatCatalog,
  StationCrew,
  StationId,
  TrackedStation,
} from "../data/api";
import { OWNER_GROUPS, SAT_CATEGORIES } from "../data/satCategories";
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

type FeedKey = "stations" | "crew" | "oem" | "issNow" | "satellites" | "earthDaily";

export type Layers = { satellites: boolean; stars: boolean; clouds: boolean };
export type SatFilter = { cats: Record<string, boolean>; owners: Record<string, boolean>; query: string };

type LiveSkyState = {
  stations: Feed<TrackedStation[]>;
  crew: Feed<StationCrew[]>;
  oem: Feed<OemWindow>;
  issNow: Feed<IssNow>;
  satellites: Feed<SatCatalog>;
  earthDaily: Feed<EarthDaily>;
  layers: Layers;
  satFilter: SatFilter;
  selectedSat: number | null;
  leftTab: "stations" | "satellites";
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
  toggleLayer: (k: keyof Layers) => void;
  setSatFilter: (f: Partial<SatFilter>) => void;
  selectSat: (id: number | null) => void;
  setLeftTab: (t: "stations" | "satellites") => void;
};

export const useLiveSky = create<LiveSkyState>((set) => ({
  stations: emptyFeed(),
  crew: emptyFeed(),
  oem: emptyFeed(),
  issNow: emptyFeed(),
  satellites: emptyFeed(),
  earthDaily: emptyFeed(),
  layers: { satellites: true, stars: true, clouds: true },
  satFilter: {
    cats: Object.fromEntries(SAT_CATEGORIES.map((c) => [c.id, true])),
    owners: Object.fromEntries(OWNER_GROUPS.map((o) => [o, true])),
    query: "",
  },
  selectedSat: null,
  leftTab: "stations",
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
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
  setSatFilter: (f) => set((s) => ({ satFilter: { ...s.satFilter, ...f } })),
  selectSat: (selectedSat) =>
    set(selectedSat === null ? { selectedSat } : { selectedSat, leftTab: "satellites" }),
  setLeftTab: (leftTab) => set({ leftTab }),
}));
