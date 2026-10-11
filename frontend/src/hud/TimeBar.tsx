import { useShallow } from "zustand/react/shallow";
import { formatOffset, isLive, simNow, TIME_RATES } from "../sim/clock";
import { useLiveSky } from "../store/liveSky";
import { useNow } from "./useNow";

const RATE_LABEL: Record<number, string> = {
  1: "1×",
  10: "10×",
  60: "1 min/s",
  600: "10 min/s",
  3600: "1 h/s",
};

/** Simulation time controls: pause, warp, jump, back to live. */
export function TimeBar() {
  const real = useNow(250);
  const { clock, togglePause, setTimeRate, jumpTime, goLive } = useLiveSky(
    useShallow((s) => ({
      clock: s.clock,
      togglePause: s.togglePause,
      setTimeRate: s.setTimeRate,
      jumpTime: s.jumpTime,
      goLive: s.goLive,
    })),
  );
  const sim = simNow(clock, real);
  const live = isLive(clock, real);
  const iso = new Date(sim).toISOString();

  return (
    <div className="timebar" role="group" aria-label="Simulation time">
      <button className="tb-btn" onClick={() => jumpTime(-3600_000)} title="Back 1 hour ( , )">
        −1h
      </button>
      <button
        className="tb-btn tb-play"
        onClick={togglePause}
        title="Pause / resume (Space)"
        aria-label={clock.paused ? "Resume" : "Pause"}
      >
        {clock.paused ? "▶" : "❚❚"}
      </button>
      <button className="tb-btn" onClick={() => jumpTime(3600_000)} title="Forward 1 hour ( . )">
        +1h
      </button>
      <div className="tb-rates" role="radiogroup" aria-label="Time rate">
        {TIME_RATES.map((r) => (
          <button
            key={r}
            role="radio"
            aria-checked={clock.rate === r}
            className={`tb-rate${clock.rate === r ? " on" : ""}`}
            onClick={() => setTimeRate(r)}
            title="Change rate with [ and ]"
          >
            {RATE_LABEL[r]}
          </button>
        ))}
      </div>
      <div className="tb-time">
        <span className="tb-date">{iso.slice(0, 10)}</span>
        <span className="tb-clock">{iso.slice(11, 19)} UTC</span>
      </div>
      {live ? (
        <span className="tb-live" title="Showing the real present">
          <span className="badge-dot" aria-hidden /> LIVE
        </span>
      ) : (
        <button className="tb-btn tb-golive" onClick={goLive} title="Return to the real present (L)">
          {formatOffset(sim - real)} · Go live
        </button>
      )}
    </div>
  );
}
