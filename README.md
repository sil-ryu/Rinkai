# Rinkai 臨界

A browser space-sim and mission-control game built on real data. The **Live Sky** view shows the International Space Station and China's Tiangong station moving in real time on a 3D globe, with ground tracks, day/night lighting, and everyone currently in space, grouped by station and agency. Later milestones add playable historical missions from NASA, CNSA, JAXA, ESA, ISRO and Roscosmos (see [docs/SPEC.md](docs/SPEC.md)).

## Run it (Windows)

Prerequisites: Node 24+, [uv](https://docs.astral.sh/uv/) (it manages Python 3.12 for you), and a browser with WebGL.

```powershell
# 1. one-time setup
copy .env.example .env          # optional: add NASA_API_KEY / LL2_API_KEY
cd backend;  uv sync;  cd ..
cd frontend; npm install; cd ..

# 2. two terminals
cd backend;  uv run uvicorn app.main:app --reload --port 8000
cd frontend; npm run dev        # open http://localhost:5173
```

**Offline mode:** set `OFFLINE=true` in `.env` (or the environment) and the backend serves only the bundled snapshots in `data/snapshots/`. No network is needed.

## How it works

```
browser (Vite + React + three.js)  --/api-->  FastAPI proxy  -->  CelesTrak, NASA, Launch Library 2, wheretheiss.at
   SGP4 propagation, globe, HUD              cache + retry + snapshot fallback
```

- The frontend never calls third parties. Every `/api` response is an envelope with `source: live | cache | snapshot`, `fetched_at`, `provider` and `attribution`, and the HUD shows that as a freshness badge.
- About 1,700–11,000 active satellites (depending on which catalogue is reachable) are propagated with SGP4 in a Web Worker and drawn as GPU points; click one for details and its orbit.
- Stations are propagated in the browser with SGP4 (`satellite.js`) from CelesTrak's element sets. NASA's ISS ephemeris (EME2000) is interpolated and shown as a cross-check ("NASA forecast Δ").
- The fallback order is fresh cache → live fetch → stale cache → bundled snapshot. A per-source lock stops concurrent requests from fetching the same rate-limited API twice.

## Commands

|                           | Frontend (`frontend/`) | Backend (`backend/`)                                         |
| ------------------------- | ---------------------- | ------------------------------------------------------------ |
| Dev server                | `npm run dev`          | `uv run uvicorn app.main:app --reload`                       |
| Tests                     | `npm test`             | `uv run pytest`                                              |
| Live API tests            | –                      | `RINKAI_NETWORK_TESTS=1 uv run pytest tests/test_network.py` |
| Lint                      | `npm run lint`         | `uv run ruff check . && uv run ruff format --check .`        |
| Typecheck                 | `npm run typecheck`    | –                                                            |
| Refresh offline snapshots | –                      | `uv run python -m app.snapshots [source_key ...]`            |
| Rebuild star field        | –                      | `uv run python -m app.starcat`                                |

Run the snapshot refresh by hand occasionally, not on a schedule: Launch Library 2's free tier allows about 15 requests per hour.

## Data sources and credits

| Data | Provider |
|---|---|
| Orbital elements (ISS, Tiangong, all active satellites) | [CelesTrak](https://celestrak.org) (GP data from the 18th Space Defense Squadron); fallback [SatNOGS DB](https://db.satnogs.org) by the Libre Space Foundation, CC BY-SA 4.0, TLEs from Space-Track.org |
| Satellite owner countries | SatNOGS DB (CC BY-SA 4.0) |
| ISS ephemeris | NASA Johnson Space Center, Flight Operations Directorate (public OEM) |
| Live ISS position | [wheretheiss.at](https://wheretheiss.at) |
| Crew in space | [Launch Library 2](https://thespacedevs.com) by The Space Devs |
| Earth imagery | NASA Blue Marble and Black Marble; daily clouds from VIIRS on NOAA-20 (corrected reflectance), all via [NASA EOSDIS GIBS](https://earthdata.nasa.gov/gibs) |
| Stars | Yale Bright Star Catalogue (Hoffleit & Warren, via CDS VizieR V/50) and ESA Gaia DR3 (ESA/Gaia/DPAC, CC BY-SA 3.0 IGO) |
| Moon map | Clementine global mosaic, Naval Research Laboratory (public domain) |

Endpoint checks and quirks are logged in [docs/data-sources.md](docs/data-sources.md).

## Project layout

```
frontend/src/{physics,scene,hud,data,store}   physics is framework-free and unit-tested
backend/app/{clients,...}                     proxy, cache, source registry
data/snapshots/                               offline fallbacks (committed)
data/missions/                                mission files (Milestone 2)
docs/                                         SPEC.md, data-sources.md
```
