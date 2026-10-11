import { useShallow } from "zustand/react/shallow";
import { useLiveSky } from "../store/liveSky";
import { TimeBar } from "./TimeBar";
import { ViewBar } from "./ViewBar";

export function BottomBar() {
  const attributions = useLiveSky(
    useShallow((s) =>
      [
        s.stations.env?.attribution,
        s.crew.env?.attribution,
        s.oem.env?.attribution,
        s.issNow.env?.attribution,
      ]
        .filter(Boolean)
        .join(" "),
    ),
  );
  return (
    <footer className="bottombar">
      <ViewBar />
      <TimeBar />
      <p
        className="attrib"
        title={`${attributions} Earth imagery: NASA Blue Marble and Black Marble via NASA EOSDIS GIBS.`}
      >
        Data: CelesTrak · NASA JSC · wheretheiss.at · Launch Library 2
        <br />
        Imagery: NASA Blue/Black Marble via GIBS
      </p>
    </footer>
  );
}
