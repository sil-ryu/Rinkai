from datetime import UTC, datetime

import httpx
import pytest
import respx

from app.cache import FileCache
from app.http import UpstreamError, fetch, redact

URL = "https://up.example.test/data"


def test_cache_roundtrip_and_missing(tmp_path):
    c = FileCache(tmp_path)
    assert c.get("nope") is None
    t = datetime(2026, 10, 10, 12, tzinfo=UTC)
    c.set("a/b?c", {"x": 1}, t)
    e = c.get("a/b?c")
    assert e.payload == {"x": 1} and e.fetched_at == t
    assert e.age_s(datetime(2026, 10, 10, 12, 0, 30, tzinfo=UTC)) == 30


def test_cache_corrupt_file_is_a_miss(tmp_path):
    c = FileCache(tmp_path)
    c.set("k", 1)
    next(tmp_path.glob("*.json")).write_text("{not json", encoding="utf-8")
    assert c.get("k") is None


@respx.mock
def test_fetch_retries_5xx_then_succeeds():
    route = respx.get(URL).mock(side_effect=[httpx.Response(503), httpx.Response(200, text="ok")])
    assert fetch(URL).text == "ok"
    assert route.call_count == 2


@respx.mock
def test_fetch_does_not_retry_4xx():
    route = respx.get(URL).mock(return_value=httpx.Response(404))
    with pytest.raises(UpstreamError, match="404"):
        fetch(URL)
    assert route.call_count == 1


@respx.mock
def test_fetch_gives_up_after_timeouts():
    route = respx.get(URL).mock(side_effect=httpx.ConnectTimeout("slow"))
    with pytest.raises(UpstreamError, match="3 attempts"):
        fetch(URL, retries=2)
    assert route.call_count == 3


def test_redact_hides_keys():
    assert (
        redact("https://api.nasa.gov/x?api_key=SECRET&y=1") == "https://api.nasa.gov/x?api_key=REDACTED&y=1"
    )


@respx.mock
def test_error_messages_never_contain_keys():
    respx.get("https://api.nasa.gov/x").mock(return_value=httpx.Response(403))
    with pytest.raises(UpstreamError) as exc:
        fetch("https://api.nasa.gov/x", params={"api_key": "SECRET"})
    assert "SECRET" not in str(exc.value)


def test_cache_reads_older_binary_format_and_survives_garbage(tmp_path):
    import json

    c = FileCache(tmp_path)
    (tmp_path / "img.bin").write_bytes(b"\xff\xd8old")
    (tmp_path / "img.json").write_text(
        json.dumps({"fetched_at": "2026-10-11T00:00:00+00:00", "payload": None, "bin": True}),
        encoding="utf-8",
    )
    assert c.get("img").payload == b"\xff\xd8old"
    (tmp_path / "bad.json").write_text(json.dumps({"fetched_at": 5, "payload": 1}), encoding="utf-8")
    assert c.get("bad") is None
