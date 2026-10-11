import { useEffect } from "react";
import { useLiveSky } from "../store/liveSky";
import { api, type Envelope } from "./api";

type FeedKey = "stations" | "crew" | "oem" | "issNow" | "satellites" | "earthDaily";

// Polling hits our backend, not upstream: the backend serves its cache until each source's TTL
// expires, so these intervals only set how quickly the HUD notices fresh data.
const FEEDS: { key: FeedKey; load: (s: AbortSignal) => Promise<Envelope<unknown>>; everyMs: number }[] = [
  { key: "stations", load: api.stations, everyMs: 30 * 60_000 },
  { key: "crew", load: api.crew, everyMs: 30 * 60_000 },
  { key: "oem", load: api.issOem, everyMs: 60 * 60_000 },
  { key: "issNow", load: api.issNow, everyMs: 10_000 },
  { key: "satellites", load: api.satellites, everyMs: 60 * 60_000 },
  { key: "earthDaily", load: api.earthDaily, everyMs: 3 * 60 * 60_000 },
];

export function usePolling() {
  const setFeed = useLiveSky((s) => s.setFeed);
  useEffect(() => {
    const ctrl = new AbortController();
    const timers: number[] = [];
    for (const f of FEEDS) {
      let inFlight = false;
      const run = async () => {
        // Never stack requests: if the backend is slow (upstream down), skip this tick.
        if (inFlight) return;
        inFlight = true;
        try {
          const env = await f.load(ctrl.signal);
          setFeed(f.key, { env: env as never, error: null, loading: false });
        } catch (e) {
          if (ctrl.signal.aborted) return;
          setFeed(f.key, { error: e instanceof Error ? e.message : String(e), loading: false });
        } finally {
          inFlight = false;
        }
      };
      run();
      timers.push(window.setInterval(run, f.everyMs));
    }
    return () => {
      ctrl.abort();
      timers.forEach(clearInterval);
    };
  }, [setFeed]);
}
