import { useLiveSky } from "../store/liveSky";
import { SHORTCUTS } from "./useKeyboard";

export function HelpOverlay() {
  const open = useLiveSky((s) => s.helpOpen);
  const setHelp = useLiveSky((s) => s.setHelp);
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
      </section>
    </div>
  );
}
