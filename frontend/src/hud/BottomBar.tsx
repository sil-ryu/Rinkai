import { useShallow } from "zustand/react/shallow";
import { useLiveSky } from "../store/liveSky";

export function BottomBar() {
  const { showTracks, toggleTracks, attributions } = useLiveSky(
    useShallow((s) => ({
      showTracks: s.showTracks,
      toggleTracks: s.toggleTracks,
      attributions: [
        s.stations.env?.attribution,
        s.crew.env?.attribution,
        s.oem.env?.attribution,
        s.issNow.env?.attribution,
      ]
        .filter(Boolean)
        .join(" "),
    })),
  );
  return (
    <footer className="bottombar">
      <div className="controls">
        <button className="btn-ghost" onClick={toggleTracks} aria-pressed={showTracks}>
          Ground tracks: {showTracks ? "on" : "off"}
        </button>
        <span className="hint">Drag to rotate · scroll to zoom · click a label to follow</span>
      </div>
      <p className="attrib">
        {attributions} Earth imagery: NASA Blue Marble and Black Marble via NASA EOSDIS GIBS.
      </p>
    </footer>
  );
}
