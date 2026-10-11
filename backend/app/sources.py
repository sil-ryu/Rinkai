"""Registry of upstream sources. One entry per endpoint: URL, TTL, attribution and snapshot file.

Every source here was probed and logged in docs/data-sources.md before being added.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import httpx

from .clients.oem import parse_oem
from .http import fetch
from .settings import Settings


@dataclass(frozen=True)
class Source:
    key: str
    provider: str
    attribution: str
    ttl_s: int
    snapshot: str  # path relative to settings.snapshot_dir
    url: Callable[[Settings], str]
    params: Callable[[Settings], dict] = field(default=lambda s: {})
    headers: Callable[[Settings], dict] = field(default=lambda s: {})
    kind: Literal["json", "text", "bytes"] = "json"
    connect_timeout_s: float = 5.0
    retries: int = 2
    # Raises ValueError/KeyError/TypeError if a 200 response isn't the expected shape; runs before caching.
    validate: Callable[[Any], None] = field(default=lambda payload: None)
    # After a failed fetch, serve stale data this long before trying again (None = derived from TTL).
    failure_cooldown_s: int | None = None


def _require(cond: bool, what: str) -> None:
    if not cond:
        raise ValueError(f"unexpected payload: {what}")


def _validate_omm_list(p: Any) -> None:
    _require(isinstance(p, list) and len(p) > 0, "non-empty OMM list")
    _require(all("NORAD_CAT_ID" in r and "EPOCH" in r for r in p), "OMM records")


def _validate_wheretheiss(p: Any) -> None:
    _require(isinstance(p, dict) and -90 <= p["latitude"] <= 90 and p["id"] == 25544, "ISS fix")


def _validate_ll2_list(p: Any) -> None:
    _require(isinstance(p, dict) and isinstance(p["results"], list), "LL2 results list")


def _validate_satnogs_tle(p: Any) -> None:
    _require(isinstance(p, list) and len(p) > 100, "SatNOGS TLE list")
    _require(all("tle1" in r and "tle2" in r and "norad_cat_id" in r for r in p), "SatNOGS TLE records")


def _validate_satnogs_sats(p: Any) -> None:
    _require(isinstance(p, list) and len(p) > 100 and "norad_cat_id" in p[0], "SatNOGS satellite list")


def _validate_jpeg(p: Any) -> None:
    _require(isinstance(p, bytes) and p[:2] == b"\xff\xd8" and len(p) > 100_000, "JPEG image")


def _satnogs_headers(s: Settings) -> dict:
    return {"Authorization": f"Token {s.satnogs_api_key}"} if s.satnogs_api_key else {}


def _ll2_headers(s: Settings) -> dict:
    return {"Authorization": f"Token {s.ll2_api_key}"} if s.ll2_api_key else {}


CELESTRAK_STATIONS = Source(
    key="celestrak_stations",
    provider="CelesTrak",
    attribution="Orbital elements: CelesTrak (celestrak.org), GP data from the 18th Space Defense Squadron.",
    # CelesTrak updates GP data a few times a day and blocks clients that re-download unchanged data.
    ttl_s=2 * 3600,
    # Connecting took ~20 s from the dev network on 2026-10-10 (curl -4); allow for it, retry once.
    connect_timeout_s=30.0,
    retries=0,
    # CelesTrak firewalls clients that re-download too often (this machine got blocked on 2026-10-11);
    # after any failure, leave it alone for two hours.
    failure_cooldown_s=2 * 3600,
    snapshot="celestrak_stations/stations.json",
    url=lambda s: "https://celestrak.org/NORAD/elements/gp.php",
    params=lambda s: {"GROUP": "stations", "FORMAT": "json"},
    validate=_validate_omm_list,
)

ISS_OEM = Source(
    key="iss_oem",
    provider="NASA JSC (ISS trajectory data)",
    attribution="ISS ephemeris: NASA Johnson Space Center, Flight Operations Directorate (public OEM).",
    ttl_s=6 * 3600,
    snapshot="iss_oem/ISS.OEM_J2K_EPH.txt",
    url=lambda s: "https://nasa-public-data.s3.amazonaws.com/iss-coords/current/ISS_OEM/ISS.OEM_J2K_EPH.txt",
    kind="text",
    validate=parse_oem,  # raises OemParseError (a ValueError) on HTML or truncated files
)

WHERETHEISS = Source(
    key="wheretheiss",
    provider="wheretheiss.at",
    attribution="Live ISS position: wheretheiss.at API.",
    ttl_s=5,  # their limit is ~1 req/s; 5 s keeps us well under it
    snapshot="wheretheiss/iss.json",
    url=lambda s: "https://api.wheretheiss.at/v1/satellites/25544",
    validate=_validate_wheretheiss,
)

LL2_EXPEDITIONS = Source(
    key="ll2_expeditions",
    provider="Launch Library 2 (The Space Devs)",
    attribution="Crew data: Launch Library 2 by The Space Devs (thespacedevs.com).",
    ttl_s=30 * 60,  # free tier is ~15 requests/hour
    snapshot="ll2_expeditions/expeditions.json",
    url=lambda s: f"{s.ll2_base_url.rstrip('/')}/expeditions/",
    params=lambda s: {"is_active": "true", "mode": "detailed", "limit": 20},
    headers=_ll2_headers,
    validate=_validate_ll2_list,
)

CELESTRAK_ACTIVE = Source(
    key="celestrak_active",
    provider="CelesTrak",
    attribution="Orbital elements: CelesTrak (celestrak.org), GP data from the 18th Space Defense Squadron.",
    ttl_s=6 * 3600,
    connect_timeout_s=30.0,
    retries=0,
    failure_cooldown_s=2 * 3600,
    snapshot="celestrak_active/active.json",
    url=lambda s: "https://celestrak.org/NORAD/elements/gp.php",
    params=lambda s: {"GROUP": "active", "FORMAT": "json"},
    validate=_validate_omm_list,
)

SATNOGS_TLE = Source(
    key="satnogs_tle",
    provider="SatNOGS DB (TLEs from Space-Track.org)",
    attribution=(
        "Satellite elements: SatNOGS DB by the Libre Space Foundation (CC BY-SA 4.0), "
        "sourced from Space-Track.org."
    ),
    ttl_s=6 * 3600,
    snapshot="satnogs_tle/tle.json",
    url=lambda s: "https://db.satnogs.org/api/tle/",
    params=lambda s: {"format": "json"},
    headers=_satnogs_headers,
    validate=_validate_satnogs_tle,
)

SATNOGS_SATS = Source(
    key="satnogs_sats",
    provider="SatNOGS DB",
    attribution="Satellite metadata: SatNOGS DB by the Libre Space Foundation (CC BY-SA 4.0).",
    ttl_s=24 * 3600,
    snapshot="satnogs_sats/satellites.json",
    url=lambda s: "https://db.satnogs.org/api/satellites/",
    params=lambda s: {"format": "json"},
    headers=_satnogs_headers,
    validate=_validate_satnogs_sats,
)


def imagery_date(now: datetime | None = None) -> str:
    """The last complete UTC day: today's composite is still filling in, and near-real-time imagery
    lags acquisition by up to ~3 h, so go back a day plus that margin."""
    return ((now or datetime.now(UTC)) - timedelta(days=1, hours=3)).date().isoformat()


GIBS_DAILY = Source(
    key="gibs_daily",
    provider="NASA EOSDIS GIBS (VIIRS NOAA-20 corrected reflectance)",
    attribution="Daily Earth imagery: NASA EOSDIS GIBS, VIIRS on NOAA-20, corrected reflectance true colour.",
    ttl_s=6 * 3600,
    snapshot="gibs_daily/viirs_truecolor.jpg",
    url=lambda s: "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi",
    params=lambda s: {
        "SERVICE": "WMS",
        "REQUEST": "GetMap",
        "VERSION": "1.3.0",
        "CRS": "EPSG:4326",
        "BBOX": "-90,-180,90,180",
        "WIDTH": 4096,
        "HEIGHT": 2048,
        "STYLES": "",
        "FORMAT": "image/jpeg",
        "LAYERS": "VIIRS_NOAA20_CorrectedReflectance_TrueColor",
        "TIME": imagery_date(),
    },
    kind="bytes",
    connect_timeout_s=10.0,
    validate=_validate_jpeg,
)

ALL_SOURCES = [
    CELESTRAK_STATIONS,
    ISS_OEM,
    WHERETHEISS,
    LL2_EXPEDITIONS,
    CELESTRAK_ACTIVE,
    SATNOGS_TLE,
    SATNOGS_SATS,
    GIBS_DAILY,
]


def fetch_source(src: Source, settings: Settings, client: httpx.Client | None = None) -> httpx.Response:
    return fetch(
        src.url(settings),
        params=src.params(settings),
        headers=src.headers(settings),
        retries=src.retries,
        connect_timeout_s=src.connect_timeout_s,
        client=client,
    )
