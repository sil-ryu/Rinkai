import { usePolling } from "./data/usePolling";
import { BottomBar } from "./hud/BottomBar";
import { HelpOverlay } from "./hud/HelpOverlay";
import { useKeyboard } from "./hud/useKeyboard";
import { CrewPanel } from "./hud/CrewPanel";
import { FlightHud, Toast } from "./hud/FlightHud";
import { useLiveSky } from "./store/liveSky";
import { StationPanel } from "./hud/StationPanel";
import { TopBar } from "./hud/TopBar";
import { Globe } from "./scene/Globe";

export function App() {
  usePolling();
  useKeyboard();
  const view = useLiveSky((s) => s.view);
  const shipActive = useLiveSky((s) => s.shipActive);
  return (
    <div className="app">
      <Globe />
      <TopBar />
      <StationPanel />
      {view === "ship" && shipActive ? <FlightHud /> : <CrewPanel />}
      {view === "free" && (
        <div className="free-hint" role="note">
          FREE CAMERA · <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> move · <kbd>R</kbd>/<kbd>F</kbd> up/down · drag to look · <kbd>Shift</kbd> ×8 · wheel:
          speed · <kbd>Esc</kbd> exit
        </div>
      )}
      <Toast />
      <BottomBar />
      <HelpOverlay />
    </div>
  );
}
