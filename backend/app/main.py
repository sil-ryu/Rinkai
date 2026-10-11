import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Response
from fastapi.middleware.gzip import GZipMiddleware

from .cache import FileCache
from .clients.crew import crew_by_station
from .clients.oem import OemParseError, parse_oem, window
from .clients.satellites import CATEGORY_LABELS, from_celestrak, from_satnogs
from .clients.stations import tracked_stations
from .envelope import Envelope
from .service import SourceUnavailable, resolve
from .settings import Settings, get_settings
from .sources import (
    ALL_SOURCES,
    CELESTRAK_ACTIVE,
    CELESTRAK_STATIONS,
    GIBS_DAILY,
    ISS_OEM,
    LL2_EXPEDITIONS,
    SATNOGS_SATS,
    SATNOGS_TLE,
    WHERETHEISS,
    Source,
    imagery_date,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
# httpx logs full request URLs at INFO, which would include api_key query params.
logging.getLogger("httpx").setLevel(logging.WARNING)

app = FastAPI(title="Rinkai data proxy", version="0.1.0")
app.add_middleware(GZipMiddleware, minimum_size=2048)


def get_cache(settings: Settings = Depends(get_settings)) -> FileCache:
    return FileCache(settings.cache_dir)


def envelope(src: Source, settings: Settings, cache: FileCache, transform: Callable[[Any], Any]) -> Envelope:
    try:
        r = resolve(src, settings, cache, background=True)
        data = transform(r.payload)
    except SourceUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    except (OemParseError, KeyError, TypeError) as exc:
        raise HTTPException(502, f"{src.key}: unexpected upstream format ({exc})") from exc
    return Envelope(
        source=r.source,
        fetched_at=r.fetched_at,
        provider=src.provider,
        attribution=src.attribution,
        data=data,
    )


@app.get("/api/health")
def health(settings: Settings = Depends(get_settings)) -> dict:
    return {"ok": True, "offline": settings.offline}


@app.get("/api/stations")
def stations(settings: Settings = Depends(get_settings), cache: FileCache = Depends(get_cache)) -> Envelope:
    """OMM records for the tracked crewed stations (ISS, Tiangong); propagate with SGP4 client-side."""
    return envelope(CELESTRAK_STATIONS, settings, cache, tracked_stations)


@app.get("/api/iss/oem")
def iss_oem(
    hours_before: float = Query(2, ge=0, le=72),
    hours_after: float = Query(24, ge=0, le=360),
    settings: Settings = Depends(get_settings),
    cache: FileCache = Depends(get_cache),
) -> Envelope:
    """NASA's ISS ephemeris (EME2000, km, km/s) trimmed to a window around now."""
    now = datetime.now(UTC)
    return envelope(
        ISS_OEM,
        settings,
        cache,
        lambda text: window(
            parse_oem(text), now, timedelta(hours=hours_before), timedelta(hours=hours_after)
        ),
    )


@app.get("/api/iss/now")
def iss_now(settings: Settings = Depends(get_settings), cache: FileCache = Depends(get_cache)) -> Envelope:
    return envelope(WHERETHEISS, settings, cache, lambda d: d)


@app.get("/api/crew")
def crew(settings: Settings = Depends(get_settings), cache: FileCache = Depends(get_cache)) -> Envelope:
    """People in space right now, grouped by station, with their agency."""
    return envelope(LL2_EXPEDITIONS, settings, cache, crew_by_station)


_catalogue_memo: dict[str, tuple[datetime, list[dict]]] = {}


def _catalogue(kind: str, fetched_at: datetime, build: Callable[[], list[dict]]) -> list[dict]:
    """Categorising ~11k names on every poll is wasteful; rebuild only when the data changes."""
    hit = _catalogue_memo.get(kind)
    if hit and hit[0] == fetched_at:
        return hit[1]
    records = build()
    _catalogue_memo[kind] = (fetched_at, records)
    return records


@app.get("/api/satellites")
def satellites(settings: Settings = Depends(get_settings), cache: FileCache = Depends(get_cache)) -> Envelope:
    """Active satellites for the sky swarm: CelesTrak's full catalogue when available, else SatNOGS."""
    try:
        meta = resolve(SATNOGS_SATS, settings, cache, background=True).payload
    except SourceUnavailable:
        meta = None
    try:
        r = resolve(CELESTRAK_ACTIVE, settings, cache, background=True, allow_block=False)
        src, records = (
            CELESTRAK_ACTIVE,
            _catalogue("celestrak", r.fetched_at, lambda: from_celestrak(r.payload, meta)),
        )
    except SourceUnavailable:
        try:
            r = resolve(SATNOGS_TLE, settings, cache, background=True)
        except SourceUnavailable as exc:
            raise HTTPException(503, str(exc)) from exc
        src, records = SATNOGS_TLE, _catalogue("satnogs", r.fetched_at, lambda: from_satnogs(r.payload, meta))
    attribution = src.attribution + (" " + SATNOGS_SATS.attribution if meta else "")
    return Envelope(
        source=r.source,
        fetched_at=r.fetched_at,
        provider=src.provider,
        attribution=attribution,
        data={"satellites": records, "categories": CATEGORY_LABELS},
    )


@app.get("/api/earth/daily")
def earth_daily(
    settings: Settings = Depends(get_settings), cache: FileCache = Depends(get_cache)
) -> Envelope:
    """Metadata for the most recent full-day VIIRS true-colour mosaic (clouds as they were that day)."""
    try:
        r = resolve(GIBS_DAILY, settings, cache, background=True)
    except SourceUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    return Envelope(
        source=r.source,
        fetched_at=r.fetched_at,
        provider=GIBS_DAILY.provider,
        attribution=GIBS_DAILY.attribution,
        data={
            "date": imagery_date(r.fetched_at),
            "image": f"/api/earth/daily.jpg?v={int(r.fetched_at.timestamp())}",
            "width": 4096,
            "height": 2048,
        },
    )


@app.get("/api/earth/daily.jpg")
def earth_daily_image(
    settings: Settings = Depends(get_settings), cache: FileCache = Depends(get_cache)
) -> Response:
    try:
        r = resolve(GIBS_DAILY, settings, cache, background=True)
    except SourceUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    return Response(
        content=r.payload,
        media_type="image/jpeg",
        # identity: JPEG doesn't compress, and this stops GZipMiddleware re-compressing 2 MB each time
        headers={
            "Cache-Control": "public, max-age=3600",
            "X-Rinkai-Source": r.source,
            "Content-Encoding": "identity",
        },
    )


@app.get("/api/sources")
def sources(settings: Settings = Depends(get_settings), cache: FileCache = Depends(get_cache)) -> list[dict]:
    """Status of every upstream, for the Data Sources screen. Does not trigger any fetch."""
    out = []
    for src in ALL_SOURCES:
        entry = cache.get(src.key)
        snap = settings.snapshot_dir / src.snapshot
        out.append(
            {
                "key": src.key,
                "provider": src.provider,
                "attribution": src.attribution,
                "ttl_s": src.ttl_s,
                "cached_at": entry.fetched_at if entry else None,
                "snapshot_available": snap.exists(),
            }
        )
    return out
