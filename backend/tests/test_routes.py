from datetime import datetime

import httpx
import pytest
import respx

from app.envelope import Envelope
from tests.test_service import join_refreshes


@pytest.fixture
def offline_client(settings, client_for):
    settings.offline = True
    return client_for(settings)


def check_envelope(body: dict, source: str = "snapshot") -> Envelope:
    env = Envelope.model_validate(body)
    assert env.source == source
    assert env.provider and env.attribution
    assert isinstance(env.fetched_at, datetime)
    return env


def test_health(offline_client):
    assert offline_client.get("/api/health").json() == {"ok": True, "offline": True}


def test_stations_has_iss_and_tiangong(offline_client):
    env = check_envelope(offline_client.get("/api/stations").json())
    ids = {s["id"]: s for s in env.data}
    assert set(ids) == {"iss", "tiangong"}
    assert ids["iss"]["omm"]["NORAD_CAT_ID"] == 25544
    assert ids["tiangong"]["omm"]["OBJECT_NAME"] == "CSS (TIANHE)"


def test_iss_oem_window(offline_client):
    env = check_envelope(offline_client.get("/api/iss/oem?hours_before=1&hours_after=1").json())
    assert env.data["frame"] == "EME2000"
    # The snapshot may not cover "now"; segments can be empty but the shape must hold.
    assert isinstance(env.data["segments"], list)


def test_iss_oem_rejects_huge_window(offline_client):
    assert offline_client.get("/api/iss/oem?hours_after=9999").status_code == 422


def test_iss_now(offline_client):
    env = check_envelope(offline_client.get("/api/iss/now").json())
    assert env.data["id"] == 25544 and -90 <= env.data["latitude"] <= 90


def test_crew_grouped_by_station_with_agencies(offline_client):
    env = check_envelope(offline_client.get("/api/crew").json())
    by = {g["station_id"]: g for g in env.data}
    assert {"iss", "tiangong"} <= set(by)
    for g in env.data:
        assert g["crew"], g
        for c in g["crew"]:
            assert c["name"] and c["agency"]
    assert {c["agency"] for c in by["tiangong"]["crew"]} == {"CNSA"}


def test_sources_listing(offline_client):
    rows = offline_client.get("/api/sources").json()
    by = {r["key"]: r for r in rows}
    assert {"celestrak_stations", "iss_oem", "wheretheiss", "ll2_expeditions", "celestrak_active"} <= set(by)
    # Everything except the full CelesTrak catalogue (unreachable when snapshots were taken) is bundled.
    assert all(r["snapshot_available"] for k, r in by.items() if k != "celestrak_active")


def test_missing_snapshot_offline_is_503(settings, client_for):
    settings.offline = True
    (settings.snapshot_dir / "wheretheiss/iss.json").unlink()
    assert client_for(settings).get("/api/iss/now").status_code == 503


@respx.mock
def test_live_path_and_ll2_key_header(settings, client_for):
    settings.ll2_api_key = "k123"
    route = respx.get("https://ll.example.test/2.3.0/expeditions/").mock(
        return_value=httpx.Response(200, json={"results": []})
    )
    body = client_for(settings).get("/api/crew").json()
    # The API answers instantly from the snapshot and refreshes upstream in the background.
    assert body["source"] == "snapshot"
    join_refreshes()
    assert route.calls.last.request.headers["Authorization"] == "Token k123"
    assert client_for(settings).get("/api/crew").json()["source"] == "cache"


def test_satellites_fall_back_to_satnogs_without_celestrak(offline_client):
    env = check_envelope(offline_client.get("/api/satellites").json())
    assert env.provider.startswith("SatNOGS")
    sats = env.data["satellites"]
    assert len(sats) > 1000
    ids = {s["id"] for s in sats}
    assert 25544 not in ids and 48274 not in ids  # stations are drawn as models
    assert all("tle" in s and len(s["tle"]) == 2 for s in sats)
    assert {s["orbit"] for s in sats} <= {"LEO", "MEO", "GEO", "HEO"}
    assert "starlink" in env.data["categories"]


def test_satellites_prefer_celestrak_when_available(settings, client_for):
    import json

    settings.offline = True
    path = settings.snapshot_dir / "celestrak_active/active.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    omm = {
        "OBJECT_NAME": "STARLINK-1007",
        "NORAD_CAT_ID": 44713,
        "EPOCH": "2026-10-10T00:00:00",
        "MEAN_MOTION": 15.06,
        "ECCENTRICITY": 0.0001,
    }
    path.write_text(json.dumps([omm]), encoding="utf-8")
    env = check_envelope(client_for(settings).get("/api/satellites").json())
    assert env.provider == "CelesTrak"
    [s] = env.data["satellites"]
    assert s["cat"] == "starlink" and s["orbit"] == "LEO" and s["omm"]["NORAD_CAT_ID"] == 44713


def test_earth_daily_metadata_and_image(offline_client):
    env = check_envelope(offline_client.get("/api/earth/daily").json())
    assert env.data["image"].startswith("/api/earth/daily.jpg")
    assert len(env.data["date"]) == 10
    img = offline_client.get("/api/earth/daily.jpg")
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg"
    assert img.content[:2] == b"\xff\xd8"


def test_large_responses_are_gzipped(offline_client):
    r = offline_client.get("/api/satellites", headers={"Accept-Encoding": "gzip"})
    assert r.headers.get("content-encoding") == "gzip"
