"""Registry of upstream sources. One entry per endpoint: URL, TTL, attribution and snapshot file.

Every source here was probed and logged in docs/data-sources.md before being added.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
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
    kind: Literal["json", "text"] = "json"
    connect_timeout_s: float = 5.0
    retries: int = 2
    # Raises ValueError/KeyError/TypeError if a 200 response isn't the expected shape; runs before caching.
    validate: Callable[[Any], None] = field(default=lambda payload: None)


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
    retries=1,
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

ALL_SOURCES = [CELESTRAK_STATIONS, ISS_OEM, WHERETHEISS, LL2_EXPEDITIONS]


def fetch_source(src: Source, settings: Settings, client: httpx.Client | None = None) -> httpx.Response:
    return fetch(
        src.url(settings),
        params=src.params(settings),
        headers=src.headers(settings),
        retries=src.retries,
        connect_timeout_s=src.connect_timeout_s,
        client=client,
    )
