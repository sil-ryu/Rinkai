import type { OMMJsonObject } from "satellite.js";
import type { OemSegment } from "../physics/oem";

export type DataOrigin = "live" | "cache" | "snapshot";

export type Envelope<T> = {
  source: DataOrigin;
  fetched_at: string;
  provider: string;
  attribution: string;
  data: T;
};

export type StationId = "iss" | "tiangong";

export type TrackedStation = {
  id: StationId;
  name: string;
  operator: string;
  norad_id: number;
  omm: OMMJsonObject;
};

export type CrewMember = {
  name: string;
  agency: string | null;
  agency_name: string | null;
  nationality: string | null;
  role: string | null;
};

export type StationCrew = {
  station_id: StationId | null;
  station: string | null;
  expedition: string | null;
  start: string | null;
  crew: CrewMember[];
};

export type OemWindow = { frame: "EME2000"; segments: OemSegment[] };

export type IssNow = {
  latitude: number;
  longitude: number;
  altitude: number;
  velocity: number;
  timestamp: number;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<Envelope<T>> {
  const res = await fetch(`/api${path}`, { signal });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, detail);
  }
  return res.json();
}

export const api = {
  stations: (s?: AbortSignal) => get<TrackedStation[]>("/stations", s),
  crew: (s?: AbortSignal) => get<StationCrew[]>("/crew", s),
  issOem: (s?: AbortSignal) => get<OemWindow>("/iss/oem?hours_before=2&hours_after=24", s),
  issNow: (s?: AbortSignal) => get<IssNow>("/iss/now", s),
};
