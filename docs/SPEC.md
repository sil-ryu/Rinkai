# RINKAI (臨界) — Project Brief for Claude Code

You are building **Rinkai**, a browser space-sim and mission-control game. The player watches the real sky (live space stations, satellites, launches and crews from many space agencies), then plays mission control on historical missions where their decisions change the odds. A "deep space" mode adds exoplanets, a real star field, and a black-hole physics lab.

This file is the single source of truth. Work milestone by milestone. **Start every milestone by posting a short plan and waiting for my OK.** One commit per milestone, only after `/milestone-check` passes.

---

## 0. Ground rules

- **Truthfulness over polish.** Every live number on screen shows where it came from (`live | cache | snapshot`) and when it was fetched. Never invent data, statistics, or API endpoints. If an endpoint doesn't behave as this brief says, stop, record the problem in `docs/data-sources.md`, and propose an alternative.
- **Mission odds are a game model.** Every probability is `tuned: true`, every mission file cites at least 2 sources, and the UI shows the label "Game model, not a prediction".
- **White holes are always labeled speculative** in UI and code comments.
- **SI units internally** (m, kg, s, rad). Convert only at render or display time.
- **Secrets** live in `.env` only (git-ignored). Never commit, log, or print them. Provide `.env.example`.
- **Offline first.** Every external source has a bundled snapshot in `data/snapshots/`, so the game runs with no network.
- **Agency neutrality.** Treat NASA, CNSA, JAXA, ESA, ISRO, Roscosmos, CSA and commercial operators the same way: real names, neutral wording, no national ranking or editorializing.

## 1. Environment (the developer's machine)

- Windows 11; Claude Code has both Bash (Git Bash) and PowerShell available.
- Node 24 / npm 11, git 2.55, Python 3.12 via the `py` launcher, **uv 0.12** (use uv for all Python work; plain `python` is not on PATH).
- **`jq` is not installed.** Hooks and helper scripts are Node `.mjs` files, not bash+jq.
- The project folder is not a git repo yet: run `git init` in Milestone 0 and create a `.gitignore` (node_modules, .venv, .env, dist, caches, `data/cache/`).

## 2. Stack

- **Frontend:** Vite + TypeScript + React (HUD/panels) + three.js (scene). State: zustand. Orbit propagation: `satellite.js` (SGP4). Tests: Vitest. Lint: ESLint + Prettier.
- **Backend:** FastAPI + httpx + pydantic v2, managed with uv. Tests: pytest + respx (mock httpx; **unit tests never hit the network**). Lint/format: ruff.
- **Layout:**
```
frontend/   src/{scene,physics,hud,missions,data,store}
backend/    app/{main.py,clients/,physics/,routes/,cache.py,settings.py}  tests/
data/       missions/*.json   snapshots/<source>/...   cache/ (gitignored)
docs/       SPEC.md  data-sources.md  missions.md
scripts/    format-file.mjs  guard-bash.mjs  refresh-snapshots.mjs
```
- Pin exact dependency versions. Keep the bundle lean: lazy-load deep-space mode.

---

## 3. Data sources

**Rule:** the frontend never calls third parties directly. Everything goes through `GET /api/<source>/...` on the backend, which adds timeouts, retry with backoff, a TTL cache, a snapshot fallback, and this envelope:

```json
{ "source": "live|cache|snapshot", "fetched_at": "ISO-8601", "provider": "CelesTrak", "attribution": "…", "data": { } }
```

Before depending on any endpoint, run the **data-source-checker** subagent and record the result in `docs/data-sources.md`. The table below was probed on **2026-10-10**; re-verify, because things change.

### 3.1 Tier 1 — core (all checked working on 2026-10-10 unless noted)

| Use in game | Provider | Endpoint | Notes |
|---|---|---|---|
| Orbits of all crewed stations (**ISS and China's Tiangong**) and other satellites | CelesTrak GP | `https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json` (also `GROUP=active`, `CATNR=<id>`) | OMM JSON → propagate client-side with SGP4. **Intermittent from the dev machine** (one timeout, one empty reply, one success). Cache ≥ 2 h; CelesTrak blocks clients that keep re-downloading unchanged data. Tiangong's core module is listed as "CSS (TIANHE)"; look it up by name or catalog number, and don't hardcode it without checking. |
| High-precision ISS track | NASA ISS trajectory data (CCSDS OEM) | `https://nasa-public-data.s3.amazonaws.com/iss-coords/current/ISS_OEM/ISS.OEM_J2K_EPH.txt` | J2000 position/velocity (km, km/s) at fixed steps, updated every few days. Parse the OEM and interpolate (Lagrange or Hermite). Use it for the "precision" ISS track and to cross-check SGP4. |
| Live ISS lat/lon/alt cross-check | wheretheiss.at | `https://api.wheretheiss.at/v1/satellites/25544` | Simple JSON. About 1 req/s limit; poll no faster than every 5 s, through the backend. |
| **All agencies' launches** (CNSA, JAXA, ISRO, ESA, Roscosmos, NASA, commercial) | Launch Library 2 (The Space Devs) | `https://ll.thespacedevs.com/2.3.0/launches/upcoming/` and `/previous/`, filter `lsp__id=<agency id>`; `/agencies/?abbrev=CNSA` | **Free tier is rate-limited to about 15 req/hour**, so cache aggressively (≥ 15 min). Develop against `https://lldev.thespacedevs.com/2.3.0/...` (stale data, relaxed limits). Look up agency IDs via `/agencies/?abbrev=` at build time and cache them; don't hardcode (CNSA = 17, verified). Optional key via `LL2_API_KEY`. |
| **Who is in space right now** (every station, every agency) | Launch Library 2 | `/2.3.0/astronauts/?in_space=true` | Returns crew with their agency. **Do not use Open Notify `astros.json`.** On 2026-10-10 it was still returning a 2024 crew list. |
| Space-station details | Launch Library 2 | `/2.3.0/space_stations/` | A query with `status__ids=1` returned HTTP 400; find the correct filter in the API docs. |
| Spaceflight news ticker, all agencies | Spaceflight News API v4 | `https://api.spaceflightnewsapi.net/v4/articles/?limit=…` | No key. Show headline, source and link only; don't copy article bodies. |
| Planet/Moon/spacecraft ephemerides | JPL Horizons API | `https://ssd.jpl.nasa.gov/api/horizons.api?format=json&COMMAND='499'…` | Use it to validate the built-in Keplerian model and to fetch spacecraft trajectories for mission replays. |
| Exoplanets | NASA Exoplanet Archive TAP | `https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=…&format=json` | ADQL. Query table `pscomppars` for one row per planet. |
| **Real star field** | **ESA Gaia DR3 TAP** | `https://gea.esac.esa.int/tap-server/tap/sync?REQUEST=doQuery&LANG=ADQL&FORMAT=json&QUERY=…` | Pre-bake a snapshot of about 50–100k brightest stars (ra, dec, phot_g_mean_mag, bp_rp → colour) into a binary file at build time. Never query this at runtime per user. |
| Earth imagery layers (NASA) | NASA GIBS WMTS | `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi?SERVICE=WMTS&REQUEST=GetCapabilities` | True-colour daily imagery, night lights. Credit "NASA EOSDIS GIBS". |
| **Earth data layers (JAXA)** | **JAXA Earth API (STAC + COG)** | `https://data.earth.jaxa.jp/stac/cog/v1/catalog.json` | Public JAXA Earth database as Cloud-Optimized GeoTIFFs: precipitation, land-surface temperature, elevation, etc. Walk the STAC catalog to pick 2–3 global layers; read tiles/overviews server-side and serve them as PNG textures. Credit JAXA per its terms. |
| Space weather (feeds a mission risk factor) | NOAA SWPC | `https://services.swpc.noaa.gov/json/planetary_k_index_1m.json` | Planetary Kp index, no key. |
| Solar flares / CMEs | NASA DONKI via api.nasa.gov | `https://api.nasa.gov/DONKI/FLR?startDate=…&api_key=…` | Returned a 301 redirect; follow redirects. The direct `kauai.ccmc.gsfc.nasa.gov` host timed out. Needs `NASA_API_KEY` (DEMO_KEY is 30/hour, 50/day). |
| Picture of the day (menu background) | NASA APOD | `https://api.nasa.gov/planetary/apod?api_key=…` | Same key. |

### 3.2 Tier 2 — optional, only if Tier 1 is done

| Source | Status on 2026-10-10 | Use |
|---|---|---|
| NASA EONET (natural events) | **HTTP 500** | Wildfires/storms on the globe. Must degrade gracefully. |
| ESA Planetary Science Archive (`psa.esa.int`) | Site up; API not checked | Rosetta, Mars Express, BepiColombo imagery for mission debriefs. |
| China Lunar & Planetary Data Release System (`moon.bao.ac.cn`) | Site up; **registration required**, mostly Chinese-language | Chang'e imagery. Only with manually downloaded, licence-checked files. No runtime dependency. |
| ISRO PRADAN / ISSDC (`pradan.issdc.gov.in`) | Site up; **registration required** | Chandrayaan imagery, same rule as above. |
| Space-Track.org | Account required | Not needed. CelesTrak covers it. |

**Being honest about CNSA, ISRO and Roscosmos:** they have no open real-time public APIs comparable to NASA's. Their presence in the game comes from (a) CelesTrak orbits (Tiangong, their satellites), (b) Launch Library 2 launches and crews, (c) curated, sourced mission files, and (d) manually downloaded archive imagery where licences allow. Say this in the in-game "Data sources" screen; don't fake live feeds.

### 3.3 Env vars (`.env.example`)
```
NASA_API_KEY=DEMO_KEY
LL2_API_KEY=
LL2_BASE_URL=https://lldev.thespacedevs.com/2.3.0   # switch to ll.thespacedevs.com for prod
CACHE_DIR=../data/cache
OFFLINE=false            # true = snapshots only, no network
```

---

## 4. Physics model

Constants and formulas live in the `physics-reference` skill (Milestone 0). Summary:
- **Keplerian orbits** for planets (JPL approximate elements, validated against Horizons), Newton–Raphson Kepler solver, elliptical orbits only (`e < 1`; handle `e ≥ 1` explicitly).
- **Satellites:** SGP4 from OMM via satellite.js; output TEME → convert to ECEF/geodetic for the globe. Note the frame in code.
- **ISS cross-check test (integration, network-marked):** with elements under 2 days old, SGP4, OEM-interpolated and wheretheiss.at positions should agree to within a few tens of km. Report the actual differences; don't loosen tolerances to make the test pass.
- **Black-hole lab:** Schwarzschild radius, photon sphere, ISCO, static-observer time dilation (returns an explicit "inside horizon" state, never NaN), tidal stretch across a body, fluid Roche limit. Visual lensing can be a shader approximation; label it as such.
- **White holes:** time-reversed Schwarzschild solution shown as a **speculative** curiosity with a clear label. No claims that they exist.

---

## 5. Mission engine

Mission files live in `data/missions/*.json`. **The reference example is `data/missions/apollo-11.json`** (already in the repo). Its schema is the canonical one: write a JSON Schema at `data/missions/mission.schema.json` from it and validate every mission file in tests (frontend and backend).

### 5.1 Resolution rules (also stored in each file's `resolution` block)
1. For each stage, in order: `p = clamp(base_success_prob × Π(multiply effects from chosen options) + Σ(add effects from risk factors and carry-over), clamp_min, clamp_max)`.
2. A chosen option with `outcome_override` ends the mission immediately with that outcome (for example abort to orbit → `aborted_safe`). No die roll.
3. **Seeded RNG** (e.g. mulberry32 or PCG): one draw per stage; on failure, a second draw picks a `failure_mode` by `weight` (weights must sum to 1 ± 1e-9; schema test).
4. Failure outcomes `aborted_safe`, `loss_of_vehicle` and `loss_of_crew` end the mission. **`degraded` does not**: the mission continues, and every later stage gets a carry-over penalty. Each mission may set `degraded_carry_over` (an `{op:"add", value}` effect); the default is `{op:"add", value:-0.03}` per degraded event, stacking.
5. Final result = the worst outcome reached (order: `success` < `degraded` < `aborted_safe` < `loss_of_vehicle` < `loss_of_crew`). A run with only degradations reports "success (degraded)".
6. **Optional live risk factor:** if the player opts into "live conditions", the current NOAA Kp index adds a small penalty to stages flagged `"space_weather_sensitive": true` (Kp ≥ 5 → −0.01, Kp ≥ 7 → −0.03). Label it in the UI as a game mechanic.
7. Same seed + same choices ⇒ identical outcome (test it). Provide a Monte-Carlo test helper that runs 10k seeds and asserts each mission's baseline success rate stays inside its `design_target_overall_success` range (Apollo 11 baseline ≈ 0.53, target band [0.5, 0.7]).

### 5.2 Mission roster (multi-agency)
Build these with `/new-mission <name>`, one at a time, each reviewed by me before commit. The one-line hooks below are **leads to verify, not facts to copy**. Confirm each claim against the cited sources (ideally the agency's own pages or mission reports) and put judgment calls in `historical_note`.

| Agency | Mission | Why it's a good game mission (verify) |
|---|---|---|
| NASA | Apollo 11 (done) | 1202 alarms, boulder field, fuel calls |
| CNSA | Chang'e 4 | First soft landing on the lunar far side; depends on the Queqiao relay satellite (a natural "relay link" decision) |
| CNSA | Chang'e 6 | Far-side sample return: landing, sampling, ascent and lunar-orbit rendezvous |
| CNSA | Tianwen-1 | Mars orbit, then orbiter + lander + Zhurong rover; long wait before the landing attempt |
| JAXA | SLIM | Precision "pinpoint" landing; engine anomaly late in descent, came to rest on its side, power problems |
| JAXA | Hayabusa2 | Asteroid Ryugu touchdowns, impactor crater, sample capsule return |
| ISRO | Chandrayaan-3 | Landing near the lunar south pole after Chandrayaan-2's lander was lost |
| ESA | Rosetta / Philae | Comet landing; harpoons didn't fire and the lander bounced |
| ESA / Roscosmos | ExoMars Schiaparelli | Mars landing demonstrator lost during descent (sensor/software issue) |
| Roscosmos | Luna 25 | Lunar lander lost after an anomalous orbital manoeuvre |
| NASA | Mars 2020 Perseverance | Entry, descent, landing with terrain-relative navigation |

Mix of outcomes is intentional: some historical runs end in failure. The debrief screen shows "what actually happened" with sources after the player's run.

---

## 6. Game screens

1. **Live Sky (home):** 3D Earth (GIBS / JAXA layer toggle), day/night terminator, ISS and Tiangong with labels, ground tracks and next-pass info, optional satellite swarm (InstancedMesh), crew-in-space panel grouped by station and agency, upcoming-launch countdown strip filterable by agency, news ticker, data-freshness badges.
2. **Mission Control:** pick a mission → stage timeline → decision prompts with flight-controller style text → odds meter that moves with choices (exact numbers hidden behind a "show model" toggle) → resolution animation → debrief with history and sources. The seed is visible and shareable.
3. **Solar System:** Keplerian planets, time controls (pause, 1×, 1 day/s, 1 yr/s), click a planet for facts and its Horizons-validated position.
4. **Deep Space:** Gaia star field, exoplanet browser (filter by method, size, star type, with a "could it be habitable?" game metric labeled as a simplification), black-hole lab with sliders, white-hole speculative corner.
5. **Data Sources screen:** every provider, licence/attribution, live status, last fetch, and the honesty note from §3.2.

Accessibility: keyboard navigable HUD, colour-blind-safe palettes, reduced-motion option, works at 1366×768 and up.

---

## 7. Milestones and acceptance criteria

### Milestone 0 — Claude Code workspace (commit "chore: claude workspace")
Create the files in **Appendix A** exactly. Then confirm the agents appear in `/agents` and the skills are listed, and run `/doctor`. Check the hook JSON fields against the current hooks reference (`code.claude.com/docs/en/hooks.md`). Verify the hooks fire by making a throwaway edit, and confirm that a blocked command (e.g. `git add .env`) is refused.

### Milestone 1 — Skeleton + Live Sky core
- Vite/React/three app and FastAPI app run with one command each; README documents setup on Windows.
- Backend proxy with cache, retry and snapshot fallback; `OFFLINE=true` works end-to-end.
- Clients: CelesTrak (stations group), NASA ISS OEM, wheretheiss.at, LL2 astronauts-in-space.
- Globe with ISS **and Tiangong** moving in real time from SGP4, ground tracks, freshness badges, crew panel.
- Tests: Kepler solver, SGP4 wrapper against a fixed OMM + known position, OEM parser + interpolation, cache/snapshot behaviour (respx), envelope schema.

### Milestone 2 — Mission engine + Mission Control
- JSON Schema, engine (§5.1) in TypeScript, plus a Python port or shared test vectors so both agree on the same seeds.
- Mission Control UI with Apollo 11 fully playable, debrief, shareable seed.
- Tests: schema validation, determinism, failure-mode weights, degraded carry-over, override aborts, Monte-Carlo band check.

### Milestone 3 — Multi-agency hub
- LL2 launches (upcoming/previous) with agency filter (CNSA, JAXA, ISRO, ESA, Roscosmos, NASA, CSA, commercial), countdown strip, launch detail drawer.
- Spaceflight News ticker. Full active-satellite swarm (quality-scaled).
- At least **three non-NASA missions** from §5.2 (one each from CNSA, JAXA, ISRO or ESA), reviewed and sourced.

### Milestone 4 — Earth layers + space weather
- GIBS true-colour and night lights; **JAXA Earth API** layers (2–3, chosen from the STAC catalog, recorded in `docs/data-sources.md`).
- NOAA Kp gauge + DONKI flare list; optional "live conditions" mission modifier (§5.1.6).

### Milestone 5 — Deep space
- Pre-baked Gaia star field snapshot + build script; exoplanet browser; Solar System view validated against Horizons for at least 3 bodies; black-hole lab; speculative white-hole corner.
- Physics tests via physics-verifier review.

### Milestone 6 — Polish
- Quality presets, performance pass (60 fps target on mid hardware), accessibility pass, remaining roster missions, `scripts/refresh-snapshots.mjs`, production build, final README with attributions.

### Definition of done (every milestone)
Lint and tests green (frontend + backend) · acceptance criteria above checked one by one with evidence · README updated · `.env` untracked · offline mode works · code-reviewer run with no Critical findings · Playwright screenshot of the main screen at 1366×768 attached to the milestone report.

---

## Appendix A — Milestone 0 files

### Layout
```
CLAUDE.md
.gitignore
.env.example
.mcp.json
.claude/settings.json
.claude/skills/{physics-reference,nasa-data-clients,render-perf,new-mission,milestone-check}/SKILL.md
.claude/agents/{physics-verifier,data-source-checker,test-runner,code-reviewer}.md
scripts/{format-file.mjs,guard-bash.mjs}
docs/data-sources.md   (start with the §3 table and today's date)
```

### CLAUDE.md
```markdown
# RINKAI (臨界)
Browser space-sim and mission-control game. Full spec: docs/SPEC.md. Read the current milestone's section before starting it.

## Commands (Windows; Python via uv)
- Frontend: `cd frontend && npm run dev | npm test | npm run lint`
- Backend: `cd backend && uv run uvicorn app.main:app --reload | uv run pytest | uv run ruff check .`

## Rules
- SI units internally; scale only at render time.
- Secrets live in .env only. Never commit or print them.
- Mission odds are game-tuned: always `tuned: true` with cited sources and a "game model, not a prediction" UI label.
- White holes are always labeled speculative.
- Every external API call goes through the backend proxy with cache and offline snapshot. Never call third parties from the frontend.
- Never invent endpoints or statistics; verify with data-source-checker and record in docs/data-sources.md.
- Agencies (NASA, CNSA, JAXA, ESA, ISRO, Roscosmos, CSA, commercial) get neutral, equal treatment.
- Delegate: test-runner for suites, physics-verifier after any formula change, data-source-checker before depending on an endpoint, code-reviewer before each milestone commit.
- Post a plan and wait for approval at the start of each milestone. One commit per milestone, only after /milestone-check passes.
```

### .claude/skills/physics-reference/SKILL.md
```markdown
---
name: physics-reference
description: Constants, formulas, units and test values for orbital, satellite, relativistic and tidal physics in Rinkai. Use when writing or changing any physics or orbit-propagation code.
paths: frontend/src/physics/**, backend/app/physics/**
user-invocable: false
---
Constants: G=6.67430e-11, c=299792458, AU=1.495978707e11 m, GM_sun=1.32712440018e20 m^3/s^2, GM_earth=3.986004418e14 m^3/s^2, R_earth(equatorial)=6378137 m.
Kepler: M = E - e*sin(E); solve E by Newton-Raphson (tol 1e-12, max 50 iterations; start E=M, or pi if e>0.8). Support e<1 only; handle e>=1 explicitly.
Satellites: SGP4 via satellite.js from OMM; output is TEME (km). Convert TEME -> ECEF -> geodetic with GMST; keep the frame in variable names (posTemeKm, posEcefM).
ISS OEM: CCSDS OEM, EME2000/J2000 frame, km and km/s; interpolate with 8-point Lagrange or Hermite (uses velocities).
Schwarzschild radius r_s = 2GM/c^2. Photon sphere 1.5 r_s. ISCO 3 r_s (non-rotating).
Static-observer time dilation dtau/dt = sqrt(1 - r_s/r); undefined for r <= r_s (return an explicit "inside horizon" state, never NaN).
Tidal acceleration across length L: 2GM*L/r^3. Fluid Roche limit: ~2.44 * R_primary * (rho_primary/rho_satellite)^(1/3).
Sanity values: Sun r_s ~ 2953 m; Earth r_s ~ 8.87 mm; Earth orbital period 365.25 d within tolerance; ISS period ~92-93 min.
Never hardcode a formula result in a test; derive expected values independently or from reference data.
```

### .claude/skills/nasa-data-clients/SKILL.md
```markdown
---
name: nasa-data-clients
description: How Rinkai fetches CelesTrak, NASA (ISS OEM, Horizons, GIBS, APOD, DONKI, Exoplanet Archive), JAXA Earth API, ESA Gaia, Launch Library 2, Spaceflight News, NOAA SWPC and wheretheiss.at data (proxy, cache, offline fallback, rate limits). Use when touching backend data clients or adding a data source.
paths: backend/app/clients/**, scripts/refresh-snapshots.mjs
user-invocable: false
---
- All external calls go through the FastAPI proxy using httpx with explicit timeouts (connect 5 s, read 20 s) and retries with exponential backoff on 5xx/timeouts only.
- Cache every response with a per-source TTL; keep a bundled snapshot in data/snapshots/<source>/ as the offline fallback. OFFLINE=true means snapshots only.
- Every response uses the envelope: source (live|cache|snapshot), fetched_at, provider, attribution, data.
- Rate limits: Launch Library 2 free tier ~15 req/hour (TTL >= 15 min, use lldev in development); CelesTrak: TTL >= 2 h, never re-download unchanged data in a loop; wheretheiss.at ~1 req/s (poll >= 5 s); NASA DEMO_KEY 30/hour 50/day.
- Gaia and Exoplanet Archive TAP queries run at build/snapshot time, never per user request.
- Open Notify astros.json is stale; use LL2 /astronauts/?in_space=true for crew.
- CNSA/ISRO/Roscosmos have no open real-time APIs; never fake one. Use CelesTrak + LL2 + curated mission files.
- API keys come from env vars only; never log URLs containing keys (redact api_key=).
- Unit tests mock httpx with respx; live checks are marked @pytest.mark.network and skipped by default.
- Before depending on a new endpoint, run the data-source-checker subagent and record the result in docs/data-sources.md.
- Respect each provider's terms and show attribution on the Data Sources screen.
```

### .claude/skills/render-perf/SKILL.md
```markdown
---
name: render-perf
description: Three.js performance and precision conventions for Rinkai scenes. Use when writing or changing rendering code.
paths: frontend/src/scene/**
user-invocable: false
---
- Floating origin: re-center the world on the camera focus to avoid float precision jitter; enable the logarithmic depth buffer.
- Satellites: one InstancedMesh or Points object; update positions in a typed array; propagate SGP4 in a Web Worker in batches; no per-frame allocations.
- Star field: one Points object from a pre-baked binary buffer (position + colour + size).
- Dispose geometries, materials and textures when removing objects.
- Provide a quality setting (low/med/high) that scales instance counts, textures and post-processing.
- Target 60 fps; profile before optimizing.
```

### .claude/skills/new-mission/SKILL.md
```markdown
---
name: new-mission
description: Add a new real-mission data file (any agency) with stages, odds and cited sources.
disable-model-invocation: true
argument-hint: [mission name]
---
Create data/missions/<slugified $ARGUMENTS>.json following data/missions/apollo-11.json and data/missions/mission.schema.json.
Rules:
- Research first: use the data-source-checker subagent or web search to find at least 2 reliable sources, preferring the operating agency's own pages and mission reports. Record them in `sources` with `used_for`.
- Every stage has base_success_prob in [0,1], at least one decision point or risk factor, and failure_modes whose weights sum to 1.
- Options matching what actually happened get "historical": true. Real failures in history are fine and should be playable.
- Every probability is `tuned: true`; do not invent statistics, and say so in `historical_note` when a value is a judgment call. Add a `todo` list for anything unverified.
- Set design_target_overall_success and a design_target_note; tune until the Monte-Carlo baseline lands inside the band.
- Add or extend tests: schema validation, seed determinism, Monte-Carlo band.
- Show me the stage table (stage, base p, effective baseline p, failure modes) and the sources for review before committing.
```

### .claude/skills/milestone-check/SKILL.md
```markdown
---
name: milestone-check
description: Run the full definition-of-done checks for the current milestone.
disable-model-invocation: true
allowed-tools: Bash(npm run *) Bash(npm test *) Bash(uv run *) Bash(git status *) Bash(git diff *)
---
## Current state
!`git status --short`

## Steps
1. Use the test-runner subagent for frontend lint and tests and backend ruff and pytest; report only failures.
2. Walk the current milestone's acceptance criteria in docs/SPEC.md one by one, with pass/fail and evidence.
3. Confirm README is updated, .env is untracked, and OFFLINE=true works with bundled snapshots.
4. Take a Playwright screenshot of the main screen at 1366x768.
5. Run the code-reviewer subagent on the diff.
6. Report. Do not commit unless every check passes.
```

### .claude/agents/physics-verifier.md
```markdown
---
name: physics-verifier
description: Independently verifies physics and orbit code and tests against formulas and reference values. Use proactively after any change to orbital, SGP4/OEM, relativity or tidal code.
tools: Read, Grep, Glob, Bash
model: inherit
---
You verify; you never edit code. For each changed formula: re-derive it, check units and reference frames (TEME vs J2000 vs ECEF), test edge cases (r <= r_s, e near 1, zero-size bodies, huge time scales, stale elements), and compare against reference values from the physics-reference skill. Run the physics tests. Report discrepancies with file:line. If a test looks wrong, report it; never alter a test to make it pass.
```

### .claude/agents/data-source-checker.md
```markdown
---
name: data-source-checker
description: Verifies that an external API endpoint (any agency or provider) is live and behaves as assumed before the project depends on it, and finds reliable sources for mission files. Use before adding or changing a data client or mission.
tools: Read, Edit, Bash, WebFetch, WebSearch
model: sonnet
---
Check the provider's current official docs, then make a small test request with curl (timeouts set, follow redirects). Confirm URL, parameters, response shape, freshness of the data (is it stale?), rate limits, auth and terms/attribution. Never print API keys. Append findings (date, endpoint, what works, caveats, fallback plan) to docs/data-sources.md and return a short summary. For mission research, return source titles, URLs and the specific facts each supports; flag anything you could not confirm.
```

### .claude/agents/test-runner.md
```markdown
---
name: test-runner
description: Runs frontend and backend tests and linters and returns only failures with the key error lines. Use whenever the full suites need running.
tools: Bash, Read, Grep
model: haiku
---
Run `npm run lint` and `npm test` in frontend/, then `uv run ruff check .` and `uv run pytest` in backend/. Return a compact report: what passed, and for each failure the test name, file:line and the essential error message. No full logs.
```

### .claude/agents/code-reviewer.md
```markdown
---
name: code-reviewer
description: Reviews code for quality, security and project-rule compliance. Use proactively before each milestone commit.
tools: Read, Grep, Glob, Bash
model: inherit
---
Run git diff and review the changes. Check: CLAUDE.md rules, no secrets or keys in logs, frontend never calls third parties directly, rate limits and cache TTLs respected, error handling and snapshot fallback, no per-frame allocations in render code, physics code has tests, mission odds marked tuned with sources, white holes labeled speculative, neutral agency wording. Report as Critical / Warning / Suggestion with concrete fixes. Do not edit files.
```

### .claude/settings.json and hook scripts (done; the files in the repo are canonical)
- Hooks are Node scripts because `jq` is not installed. On Windows, Claude Code runs hook commands through Git Bash.
- `PostToolUse`, matcher `Edit|Write` (exact tool names, not a regex): `node "${CLAUDE_PROJECT_DIR}/scripts/format-file.mjs"` runs ruff format for .py (in backend/) and prettier for ts/tsx/js/mjs/json/css/md (in frontend/). It skips silently if those folders or tools don't exist yet, and always exits 0.
- `PreToolUse`, matcher `Bash|PowerShell`: `node "${CLAUDE_PROJECT_DIR}/scripts/guard-bash.mjs"` exits 2 (block) when a command stages or commits `.env` or force-pushes. `.env.example` is allowed. The match is on the raw command text, so even an `echo` mentioning those commands is blocked; put such text in a file instead.
- Permissions allow npm run/test, `uv run`, git status/diff, and deny reading `.env`.
- Verified 2026-10-10: 11 guard test cases pass, and the live hook blocked a probe command in-session.

### .mcp.json (pinned to @playwright/mcp 0.0.82, released 2026-09-18)
```json
{
  "mcpServers": {
    "playwright": { "type": "stdio", "command": "npx", "args": ["-y", "@playwright/mcp@0.0.82"] }
  }
}
```
Use it to load the dev server, screenshot the canvas, and check the HUD at 1366×768. If WebGL screenshots come back blank, check headless/WebGL flags before assuming the scene is broken.

### After Milestone 1
- Run `/run-skill-generator` once (if available in this Claude Code version) so `/run` knows how to launch this app.
- Use `/milestone-check` before every milestone commit.
- Run `/doctor` if a skill, agent or hook isn't taking effect.
