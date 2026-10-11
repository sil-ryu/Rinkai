"""Resolve a source: fresh cache -> live fetch -> stale cache -> bundled snapshot.

Live fetches are serialized per source and suppressed for a cooldown after a failure, so a
flaky upstream can't pile up blocked requests or hammer a rate-limited API.
"""

import json
import logging
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from .cache import FileCache
from .envelope import DataOrigin
from .http import UpstreamError
from .settings import Settings
from .sources import ALL_SOURCES, Source, fetch_source

log = logging.getLogger("rinkai.service")

_locks: dict[str, threading.Lock] = {s.key: threading.Lock() for s in ALL_SOURCES}
_last_failure: dict[str, datetime] = {}


class SourceUnavailable(Exception):
    pass


@dataclass(frozen=True)
class Resolved:
    source: DataOrigin
    fetched_at: datetime
    payload: Any


def cooldown_s(src: Source) -> float:
    """After a failed fetch, serve stale data for this long before trying upstream again."""
    return min(max(60, src.ttl_s), 15 * 60)


def snapshot_meta_path(path: Path) -> Path:
    return path.with_name(path.name + ".meta.json")


def _parse(src: Source, text: str) -> Any:
    return json.loads(text) if src.kind == "json" else text


def load_snapshot(src: Source, settings: Settings) -> Resolved:
    path = settings.snapshot_dir / src.snapshot
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise SourceUnavailable(f"{src.key}: no live data, cache or snapshot") from exc
    # The real fetch time lives in a sidecar written by app.snapshots; file mtime is only a
    # fallback because a git checkout resets it.
    try:
        fetched_at = datetime.fromisoformat(json.loads(snapshot_meta_path(path).read_text())["fetched_at"])
    except (FileNotFoundError, ValueError, KeyError):
        fetched_at = datetime.fromtimestamp(path.stat().st_mtime, UTC)
    return Resolved("snapshot", fetched_at, _parse(src, text))


def resolve(
    src: Source,
    settings: Settings,
    cache: FileCache,
    *,
    client: httpx.Client | None = None,
    now: datetime | None = None,
    background: bool = False,
) -> Resolved:
    """With background=True (used by the API), never block on upstream: serve the stale cache or the
    snapshot immediately and refresh in a background thread. Slow upstreams (CelesTrak connects can
    take 20+ s) then never stall the UI."""
    if settings.offline:
        return load_snapshot(src, settings)

    if background:
        now = now or datetime.now(UTC)
        cached = cache.get(src.key)
        if cached and cached.age_s(now) < src.ttl_s:
            return Resolved("cache", cached.fetched_at, cached.payload)
        try:
            stale = _fallback(src, settings, cached)
        except SourceUnavailable:
            stale = None  # nothing to serve yet: fetch synchronously below
        if stale is not None:
            _refresh_in_background(src, settings, cache)
            return stale

    lock = _locks.setdefault(src.key, threading.Lock())
    with lock:
        return _resolve_online(src, settings, cache, client, now or datetime.now(UTC))


_refreshing: set[str] = set()
_refreshing_lock = threading.Lock()


def _refresh_in_background(src: Source, settings: Settings, cache: FileCache) -> None:
    with _refreshing_lock:
        if src.key in _refreshing:
            return
        _refreshing.add(src.key)

    def run() -> None:
        try:
            with _locks.setdefault(src.key, threading.Lock()):
                _resolve_online(src, settings, cache, None, datetime.now(UTC))
        except Exception:  # never let a background refresh crash the worker thread
            log.exception("%s background refresh failed", src.key)
        finally:
            with _refreshing_lock:
                _refreshing.discard(src.key)

    threading.Thread(target=run, name=f"refresh-{src.key}", daemon=True).start()


def _fallback(src: Source, settings: Settings, cached) -> Resolved:
    if cached:
        return Resolved("cache", cached.fetched_at, cached.payload)
    return load_snapshot(src, settings)


def _resolve_online(
    src: Source, settings: Settings, cache: FileCache, client: httpx.Client | None, now: datetime
) -> Resolved:
    cached = cache.get(src.key)
    if cached and cached.age_s(now) < src.ttl_s:
        return Resolved("cache", cached.fetched_at, cached.payload)

    failed_at = _last_failure.get(src.key)
    if failed_at and (now - failed_at).total_seconds() < cooldown_s(src):
        return _fallback(src, settings, cached)

    try:
        payload = _parse(src, fetch_source(src, settings, client).text)
        src.validate(payload)
    except (UpstreamError, ValueError, KeyError, TypeError) as exc:
        # ValueError covers bad JSON, an empty body and validator rejections (e.g. a 200 HTML page).
        log.warning("%s live fetch failed: %s", src.key, exc)
        _last_failure[src.key] = now
        return _fallback(src, settings, cached)

    _last_failure.pop(src.key, None)
    entry = cache.set(src.key, payload, now)
    return Resolved("live", entry.fetched_at, payload)
