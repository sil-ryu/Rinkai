import { usePolling } from "./data/usePolling";
import { BottomBar } from "./hud/BottomBar";
import { HelpOverlay } from "./hud/HelpOverlay";
import { useKeyboard } from "./hud/useKeyboard";
import { CrewPanel } from "./hud/CrewPanel";
import { StationPanel } from "./hud/StationPanel";
import { TopBar } from "./hud/TopBar";
import { Globe } from "./scene/Globe";

export function App() {
  usePolling();
  useKeyboard();
  return (
    <div className="app">
      <Globe />
      <TopBar />
      <StationPanel />
      <CrewPanel />
      <BottomBar />
      <HelpOverlay />
    </div>
  );
}
