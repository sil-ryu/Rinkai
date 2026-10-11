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
    assert {r["key"] for r in rows} == {"celestrak_stations", "iss_oem", "wheretheiss", "ll2_expeditions"}
    assert all(r["snapshot_available"] for r in rows)


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
