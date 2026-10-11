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

## 2026-10-10 — Milestone 1 findings

- **Tiangong confirmed in CelesTrak `GROUP=stations`:** NORAD 48274 "CSS (TIANHE)" (also WENTIAN 53239, MENGTIAN 54216, plus visiting Shenzhou/Tianzhou). ISS is 25544 "ISS (ZARYA)".
- **CelesTrak connect latency:** the IPv4 TCP connect took ~20 s from the dev network (DNS via Cloudflare WARP). The client now uses a 30 s connect timeout and 1 retry for CelesTrak. A 200 response with an empty body was also seen; the service never lets an empty payload overwrite good cache.
- **LL2 crew:** `/2.3.0/expeditions/?is_active=true&mode=detailed` returns both active expeditions (ISS Expedition 75, Shenzhou 23) with full crew and agencies in one request. `/space_stations/` rejects `mode=list` (only `normal|detailed`); that was the cause of the earlier 400. The **`lldev` host returned a stale ISS crew** (an earlier expedition), so the default is now production LL2 (crew TTL 30 min ≈ 2 req/hour).
- **ISS OEM:** 4-minute steps with **extra samples at traffic events** (e.g. 60, 104, 136, 180 s gaps). The file's COMMENT block has a trajectory event table (vehicle departures, launches, dockings), which could feed a future "station traffic" feature. Interpolation is 8-point Lagrange on uneven nodes (leave-one-out error < 50 m).
- **OEM vs SGP4:** the difference is almost purely **along-track** (radial < 0.3 km) and grows over time: 5.8 km → 9.5 km → 14.7 km on 10-09 23:00 / 10-10 12:46 / 10-11 12:00 UTC. NASA's file is a forecast issued 2026-10-07, so fresh CelesTrak elements are the more current source. The globe uses SGP4 as primary and shows NASA's forecast as "NASA forecast Δ". At the wheretheiss.at timestamp: SGP4–API 0.5 km, OEM–API 9.1 km.
- **Images:** LL2 astronaut portraits are third-party URLs. They are not shown until an image proxy exists (frontend must not call third parties).

## 2026-10-11 — satellites, sky and daily imagery

- **CelesTrak blocked this IP.** From mid-morning every connection to `celestrak.org` and `celestrak.com` failed at the Windows 21 s TCP limit, while other hosts worked. CelesTrak firewalls clients that re-download too often; our probes plus early backend refreshes likely tripped it. Mitigation: CelesTrak sources now use `retries=0` and a **2-hour failure cooldown**, background refreshes respect the cooldown, and the API never blocks on CelesTrak. When reachable, `GROUP=active` (~11k satellites) is preferred automatically. The snapshot script will also fetch `celestrak_active` once access returns; run it by hand, no more than once a day.
- **SatNOGS DB** (`https://db.satnogs.org/api/tle/?format=json`, `/api/satellites/?format=json`): 200, 1,730 TLEs (source Space-Track.org) and 2,832 satellite records with `countries`. Responds in ~1.5 s. Licence CC BY-SA 4.0. Used as the swarm fallback (~1,728 after excluding ISS/CSS) and for owner countries. Its "status=alive" filter returns 400; filtering isn't needed.
- **NASA GIBS WMS daily VIIRS** (`LAYERS=VIIRS_NOAA20_CorrectedReflectance_TrueColor&TIME=<yesterday>`, 4096x2048 JPEG): 200, ~2.2 MB. Black where there is no data (polar night, swath gaps); the Earth shader falls back to Blue Marble there. Yesterday's date is used because today's composite is still filling in.
- **Yale Bright Star Catalogue** via CDS VizieR TAP (`V/50/catalog`): 9,096 rows with V; `RAJ2000/DEJ2000` are in degrees.
- **ESA Gaia DR3 TAP:** 62,723 sources with G < 8; we take 6.5 ≤ G < 7.8 (38,516). Built once into `frontend/public/data/stars.bin` by `uv run python -m app.starcat`.
- **Moon texture:** NASA SVS (`svs.gsfc.nasa.gov`) was unreachable from this network (same 21 s failure). Used the Clementine global mosaic from Wikimedia Commons (`Moonmap_from_clementine_data.png`, 1440x720, public domain, Naval Research Laboratory), converted to JPEG.
- **JPL Horizons** Moon reference positions (target 301, geocentric, apparent RA/Dec + range) for 2026-10-11 00:00 and 2027-03-01 12:00 UT are used in `moon.test.ts`.
