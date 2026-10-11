import { useLiveSky } from "../store/liveSky";
import { useShallow } from "zustand/react/shallow";
import { STATIC_CREDITS } from "./credits";
import { SHORTCUTS } from "./useKeyboard";

export function HelpOverlay() {
  const open = useLiveSky((s) => s.helpOpen);
  const setHelp = useLiveSky((s) => s.setHelp);
  const attributions = useLiveSky(
    useShallow((s) => [
      ...new Set(
        [s.stations.env, s.satellites.env, s.crew.env, s.oem.env, s.issNow.env, s.earthDaily.env]
          .filter((e) => e !== null)
          .map((e) => e.attribution)
          .concat(STATIC_CREDITS),
      ),
    ]),
  );
  if (!open) return null;
  return (
    <div className="help-backdrop" onClick={() => setHelp(false)}>
      <section
        className="help"
        role="dialog"
        aria-modal="true"
        aria-label="Controls"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h1>Controls</h1>
          <button className="btn-ghost" onClick={() => setHelp(false)} autoFocus>
            Close
          </button>
        </header>
        <dl>
          {SHORTCUTS.map(([k, v]) => (
            <div key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="muted">
          Station models are procedural approximations of the current configuration, at true scale and in
          their real flight attitude (flying forward along the orbit, solar arrays tracking the Sun). Visiting
          vehicles are omitted except Tiangong&apos;s usual Shenzhou and Tianzhou.
        </p>
        <h2 className="credits-h">Credits</h2>
        <ul className="credits">
          {attributions.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
