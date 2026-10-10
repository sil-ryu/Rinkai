import { usePolling } from "./data/usePolling";
import { BottomBar } from "./hud/BottomBar";
import { CrewPanel } from "./hud/CrewPanel";
import { StationPanel } from "./hud/StationPanel";
import { TopBar } from "./hud/TopBar";
import { Globe } from "./scene/Globe";

export function App() {
  usePolling();
  return (
    <div className="app">
      <Globe />
      <TopBar />
      <StationPanel />
      <CrewPanel />
      <BottomBar />
    </div>
  );
}
