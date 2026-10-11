import { useShallow } from "zustand/react/shallow";
import { useLiveSky } from "../store/liveSky";
import { shortProvider, STATIC_CREDITS } from "./credits";
import { TimeBar } from "./TimeBar";
import { ViewBar } from "./ViewBar";

export function BottomBar() {
  const { providers, attributions } = useLiveSky(
    useShallow((s) => {
      const envs = [s.stations.env, s.satellites.env, s.crew.env, s.oem.env, s.issNow.env, s.earthDaily.env];
      const present = envs.filter((e) => e !== null);
      return {
        // Providers actually serving data right now (e.g. SatNOGS when CelesTrak is unreachable).
        providers: [...new Set(present.map((e) => shortProvider(e.provider)))].join(" · "),
        attributions: present.map((e) => e.attribution).join(" "),
      };
    }),
  );
  return (
    <footer className="bottombar">
      <ViewBar />
      <TimeBar />
      <p className="attrib" title={`${attributions} ${STATIC_CREDITS.join(" ")}`}>
        Data: {providers || "loading…"}
        <br />
        Imagery: NASA GIBS · Stars: Yale BSC, ESA/Gaia/DPAC (CC BY-SA 3.0 IGO) · Moon: NRL Clementine
      </p>
    </footer>
  );
}
