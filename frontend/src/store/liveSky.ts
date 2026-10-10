import { create } from "zustand";
import type { Envelope, IssNow, OemWindow, StationCrew, StationId, TrackedStation } from "../data/api";
import type { SatState } from "../physics/sgp4";

export type Feed<T> = { env: Envelope<T> | null; error: string | null; loading: boolean };

const emptyFeed = <T>(): Feed<T> => ({ env: null, error: null, loading: true });

export type StationLive = {
  state: SatState | null;
  /** NASA predicted ephemeris at the same instant, for the ISS only. */
  oemState: SatState | null;
  elementAgeH: number | null;
};

type LiveSkyState = {
  stations: Feed<TrackedStation[]>;
  crew: Feed<StationCrew[]>;
  oem: Feed<OemWindow>;
  issNow: Feed<IssNow>;
  live: Partial<Record<StationId, StationLive>>;
  focus: StationId | null;
  follow: boolean;
  showTracks: boolean;
  setFeed: <K extends "stations" | "crew" | "oem" | "issNow">(key: K, feed: Partial<LiveSkyState[K]>) => void;
  setLive: (live: Partial<Record<StationId, StationLive>>) => void;
  setFocus: (id: StationId | null) => void;
  toggleFollow: () => void;
  toggleTracks: () => void;
};

export const useLiveSky = create<LiveSkyState>((set) => ({
  stations: emptyFeed(),
  crew: emptyFeed(),
  oem: emptyFeed(),
  issNow: emptyFeed(),
  live: {},
  focus: null,
  follow: false,
  showTracks: true,
  setFeed: (key, feed) => set((s) => ({ [key]: { ...s[key], ...feed } }) as Partial<LiveSkyState>),
  setLive: (live) => set({ live }),
  setFocus: (focus) => set({ focus, follow: focus !== null }),
  toggleFollow: () => set((s) => ({ follow: !s.follow })),
  toggleTracks: () => set((s) => ({ showTracks: !s.showTracks })),
}));
