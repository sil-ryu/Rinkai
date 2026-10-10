# Data sources log

Append-only log of endpoint checks (newest at the bottom). The data-source-checker subagent adds entries here before the project depends on an endpoint. Format: date, endpoint, result, caveats, fallback.

## 2026-10-10 — initial probe (curl from the dev machine, Windows 11)

| Provider | Endpoint | Result | Caveats / fallback |
|---|---|---|---|
| wheretheiss.at | `https://api.wheretheiss.at/v1/satellites/25544` | 200 JSON (lat, lon, alt km, velocity km/h, visibility) | ~1 req/s limit. Fallback: SGP4 from CelesTrak snapshot. |
| Open Notify | `http://api.open-notify.org/iss-now.json` | 200 JSON | HTTP only. Not used; wheretheiss.at preferred. |
| Open Notify | `http://api.open-notify.org/astros.json` | 200 JSON but **stale** (2024 ISS crew) | **Do not use.** Use LL2 astronauts `in_space=true`. |
| CelesTrak GP | `https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json` | 1st try timeout; 2nd 200 with OMM JSON (first object "ISS (ZARYA)"); 3rd empty body | **Flaky from this machine.** Cache ≥ 2 h, snapshot fallback mandatory. Tiangong entry name/catalog number still to confirm. |
| NASA ISS OEM | `https://nasa-public-data.s3.amazonaws.com/iss-coords/current/ISS_OEM/ISS.OEM_J2K_EPH.txt` | 200, CCSDS OEM v2.0, created 2026-10-07 | Updated every few days; check `CREATION_DATE` and the usable time span. |
| Launch Library 2 | `https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=1&mode=list` | 200 JSON, count 473 | Free tier ~15 req/hour. |
| Launch Library 2 (dev) | `https://lldev.thespacedevs.com/2.3.0/agencies/?limit=1` | 200 JSON, 350 agencies | Stale data, relaxed limits; use in development. |
| Launch Library 2 | `/2.3.0/agencies/?abbrev=CNSA` | 200, id 17 | Resolve other agency IDs the same way. |
| Launch Library 2 | `/2.3.0/astronauts/?in_space=true` | 200 JSON with agency per astronaut | Records include non-humans (e.g. "Starman"); filter by type. |
| Launch Library 2 | `/2.3.0/space_stations/?status__ids=1` | **400** | Find the correct filter in the API docs. |
| Spaceflight News API | `https://api.spaceflightnewsapi.net/v4/articles/?limit=1` | 200 JSON | Show headline/source/link only. |
| JAXA Earth API | `https://data.earth.jaxa.jp/stac/cog/v1/catalog.json` | 200 STAC 1.0.0 catalog ("STAC for JAXA Earth database (COG)") | Pick layers in M4; check JAXA terms and attribution text. |
| NASA APOD | `https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY` | 200 JSON | DEMO_KEY 30/hour, 50/day. |
| JPL Horizons | `https://ssd.jpl.nasa.gov/api/horizons.api?format=json&COMMAND='499'&OBJ_DATA='YES'&MAKE_EPHEM='NO'` | 200 JSON (Mars data) | |
| NASA Exoplanet Archive | `https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=select+top+1+pl_name+from+ps&format=json` | 200 JSON | Use `pscomppars` for one row per planet. |
| ESA Gaia DR3 TAP | `https://gea.esac.esa.int/tap-server/tap/sync?REQUEST=doQuery&LANG=ADQL&FORMAT=json&QUERY=SELECT+TOP+1+source_id+FROM+gaiadr3.gaia_source` | 200 JSON | Snapshot/build time only. |
| NASA DONKI (direct) | `https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/FLR?...` | timeout | Use api.nasa.gov route. |
| NASA DONKI (api.nasa.gov) | `https://api.nasa.gov/DONKI/FLR?startDate=...&api_key=...` | 301 redirect | Follow redirects; re-check body in M4. |
| NASA EONET | `https://eonet.gsfc.nasa.gov/api/v3/events?limit=1` | **500** (twice) | Tier 2 only; degrade gracefully. |
| NOAA SWPC | `https://services.swpc.noaa.gov/json/planetary_k_index_1m.json` | 200 JSON | |
| NASA GIBS | `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi?SERVICE=WMTS&REQUEST=GetCapabilities` | 200 XML capabilities | Credit "NASA EOSDIS GIBS". |
| ESA PSA | `https://psa.esa.int/` | 200 HTML | API not checked. |
| CLPDS (CNSA lunar data) | `https://moon.bao.ac.cn/` | 200 HTML | Registration required; no runtime dependency. |
| ISRO PRADAN | `https://pradan.issdc.gov.in/` | 200 HTML | Registration required; no runtime dependency. |
