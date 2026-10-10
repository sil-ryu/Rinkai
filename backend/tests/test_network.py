"""Live checks against real upstreams. Skipped unless RINKAI_NETWORK_TESTS=1.

Be gentle: Launch Library 2 allows ~15 requests/hour, so it is not tested here.
"""

import pytest

from app.clients.oem import parse_oem
from app.clients.stations import tracked_stations
from app.sources import CELESTRAK_STATIONS, ISS_OEM, WHERETHEISS, fetch_source

pytestmark = pytest.mark.network


def test_celestrak_has_both_stations(settings):
    data = fetch_source(CELESTRAK_STATIONS, settings).json()
    assert {s["id"] for s in tracked_stations(data)} == {"iss", "tiangong"}


def test_oem_parses(settings):
    assert parse_oem(fetch_source(ISS_OEM, settings).text)["segments"]


def test_wheretheiss(settings):
    assert fetch_source(WHERETHEISS, settings).json()["id"] == 25544
