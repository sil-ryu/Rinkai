---
name: nasa-data-clients
description: How Rinkai fetches CelesTrak, NASA (ISS OEM, Horizons, GIBS, APOD, DONKI, Exoplanet Archive), JAXA Earth API, ESA Gaia, Launch Library 2, Spaceflight News, NOAA SWPC and wheretheiss.at data (proxy, cache, offline fallback, rate limits). Use when touching backend data clients or adding a data source.
paths: backend/app/clients/**, backend/app/sources.py, backend/app/service.py, backend/app/snapshots.py
user-invocable: false
---
- All external calls go through the FastAPI proxy using httpx with explicit timeouts (connect 5 s, read 20 s) and retries with exponential backoff on 5xx/timeouts only.
- Cache every response with a per-source TTL; keep a bundled snapshot in data/snapshots/<source>/ as the offline fallback. OFFLINE=true means snapshots only.
- Every response uses the envelope: source (live|cache|snapshot), fetched_at, provider, attribution, data.
- Rate limits: Launch Library 2 free tier ~15 req/hour (TTL >= 15 min; production host by default, since lldev serves stale data); CelesTrak: TTL >= 2 h, never re-download unchanged data in a loop, connect can take ~20 s (30 s connect timeout); wheretheiss.at ~1 req/s (poll >= 5 s); NASA DEMO_KEY 30/hour 50/day.
- Gaia and Exoplanet Archive TAP queries run at build/snapshot time, never per user request.
- Open Notify astros.json is stale. Crew comes from LL2 /expeditions/?is_active=true&mode=detailed (all stations, crew and agencies in one request).
- CNSA/ISRO/Roscosmos have no open real-time APIs; never fake one. Use CelesTrak + LL2 + curated mission files.
- API keys come from env vars only; never log URLs containing keys (redact api_key=).
- Unit tests mock httpx with respx; live checks are marked @pytest.mark.network and skipped by default.
- Before depending on a new endpoint, run the data-source-checker subagent and record the result in docs/data-sources.md.
- Respect each provider's terms and show attribution on the Data Sources screen.
