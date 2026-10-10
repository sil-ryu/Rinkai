from datetime import UTC, datetime, timedelta

import httpx
import pytest
import respx

from app.cache import FileCache
from app.service import SourceUnavailable, cooldown_s, resolve, snapshot_meta_path
from app.sources import CELESTRAK_STATIONS as SRC
from app.sources import ISS_OEM

URL = "https://celestrak.org/NORAD/elements/gp.php"
NOW = datetime(2026, 10, 10, 12, tzinfo=UTC)
LIVE = [{"NORAD_CAT_ID": 25544, "OBJECT_NAME": "ISS (ZARYA)", "EPOCH": "2026-10-10T00:00:00", "live": True}]


@pytest.fixture
def cache(settings):
    return FileCache(settings.cache_dir)


def test_offline_uses_snapshot_without_network(settings, cache):
    settings.offline = True
    with respx.mock(assert_all_called=False) as m:
        route = m.get(URL)
        r = resolve(SRC, settings, cache, now=NOW)
    assert r.source == "snapshot" and not route.called
    assert any(o["NORAD_CAT_ID"] == 25544 for o in r.payload)


def test_fresh_cache_skips_network(settings, cache):
    cache.set(SRC.key, LIVE, NOW - timedelta(minutes=10))
    with respx.mock(assert_all_called=False) as m:
        route = m.get(URL)
        r = resolve(SRC, settings, cache, now=NOW)
    assert r.source == "cache" and not route.called


@respx.mock
def test_stale_cache_refetches_and_stores(settings, cache):
    cache.set(SRC.key, [{"old": True}], NOW - timedelta(hours=3))
    respx.get(URL).mock(return_value=httpx.Response(200, json=LIVE))
    r = resolve(SRC, settings, cache, now=NOW)
    assert r.source == "live" and r.payload == LIVE
    assert cache.get(SRC.key).payload == LIVE


@respx.mock
def test_live_failure_falls_back_to_stale_cache(settings, cache):
    cache.set(SRC.key, [{"old": True}], NOW - timedelta(hours=3))
    respx.get(URL).mock(return_value=httpx.Response(503))
    r = resolve(SRC, settings, cache, now=NOW)
    assert r.source == "cache" and r.payload == [{"old": True}]


@respx.mock
def test_live_failure_without_cache_uses_snapshot(settings, cache):
    respx.get(URL).mock(side_effect=httpx.ConnectTimeout("down"))
    assert resolve(SRC, settings, cache, now=NOW).source == "snapshot"


@respx.mock
def test_empty_200_does_not_overwrite_cache(settings, cache):
    """CelesTrak was seen answering 200 with an empty body on 2026-10-10."""
    cache.set(SRC.key, LIVE, NOW - timedelta(hours=3))
    respx.get(URL).mock(return_value=httpx.Response(200, text=""))
    r = resolve(SRC, settings, cache, now=NOW)
    assert r.source == "cache" and r.payload == LIVE
    assert cache.get(SRC.key).payload == LIVE


@respx.mock
def test_nothing_available_raises(settings, cache):
    (settings.snapshot_dir / SRC.snapshot).unlink()
    respx.get(URL).mock(return_value=httpx.Response(500))
    with pytest.raises(SourceUnavailable):
        resolve(SRC, settings, cache, now=NOW)


def test_concurrent_requests_fetch_upstream_once(settings, cache):
    import threading

    with respx.mock() as m:
        route = m.get(URL).mock(return_value=httpx.Response(200, json=LIVE))
        results = []
        threads = [
            threading.Thread(target=lambda: results.append(resolve(SRC, settings, cache))) for _ in range(8)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
    assert route.call_count == 1
    assert sorted(r.source for r in results) == ["cache"] * 7 + ["live"]


def test_cache_set_tolerates_concurrent_writers(settings, cache):
    import threading

    threads = [threading.Thread(target=cache.set, args=(SRC.key, [{"i": i}])) for i in range(16)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert cache.get(SRC.key) is not None
    assert not list(settings.cache_dir.glob("*.tmp"))


@respx.mock
def test_failure_cooldown_skips_upstream(settings, cache):
    """A flaky upstream must not be retried on every request (requests would pile up behind the lock)."""
    route = respx.get(URL).mock(return_value=httpx.Response(503))
    assert resolve(SRC, settings, cache, now=NOW).source == "snapshot"
    calls = route.call_count
    later = NOW + timedelta(seconds=cooldown_s(SRC) - 1)
    assert resolve(SRC, settings, cache, now=later).source == "snapshot"
    assert route.call_count == calls  # no new upstream request during cooldown
    route.mock(return_value=httpx.Response(200, json=LIVE))
    after = NOW + timedelta(seconds=cooldown_s(SRC) + 1)
    assert resolve(SRC, settings, cache, now=after).source == "live"


@respx.mock
def test_html_200_is_not_cached(settings, cache):
    """A captive portal or error page answering 200 must not replace good data."""
    respx.get(ISS_OEM.url(settings)).mock(return_value=httpx.Response(200, text="<html>Oops</html>"))
    r = resolve(ISS_OEM, settings, cache, now=NOW)
    assert r.source == "snapshot" and "CCSDS_OEM_VERS" in r.payload
    assert cache.get(ISS_OEM.key) is None


@respx.mock
def test_wrong_shape_json_is_not_cached(settings, cache):
    respx.get(URL).mock(return_value=httpx.Response(200, json={"error": "rate limited"}))
    assert resolve(SRC, settings, cache, now=NOW).source == "snapshot"
    assert cache.get(SRC.key) is None


def test_snapshot_uses_sidecar_fetch_time_not_mtime(settings):
    path = settings.snapshot_dir / SRC.snapshot
    snapshot_meta_path(path).write_text('{"fetched_at": "2026-01-02T03:04:05+00:00"}', encoding="utf-8")
    settings.offline = True
    r = resolve(SRC, settings, FileCache(settings.cache_dir))
    assert r.fetched_at == datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)


def test_httpx_request_logging_is_quiet():
    """httpx logs full URLs (including api_key params) at INFO; the app must keep it at WARNING."""
    import logging

    import app.main  # noqa: F401  (configures logging on import)

    assert logging.getLogger("httpx").getEffectiveLevel() >= logging.WARNING
