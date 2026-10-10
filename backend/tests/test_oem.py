import math
from datetime import UTC, datetime, timedelta

import pytest

from app.clients.oem import OemParseError, parse_oem, window
from app.settings import REPO_DIR

SNAP = (REPO_DIR / "data/snapshots/iss_oem/ISS.OEM_J2K_EPH.txt").read_text(encoding="utf-8")

MINI = """CCSDS_OEM_VERS = 2.0
ORIGINATOR = TEST
META_START
OBJECT_NAME = ISS
CENTER_NAME = Earth
REF_FRAME = EME2000
TIME_SYSTEM = UTC
META_STOP
COMMENT ignore me
2026-10-07T12:00:00.000 1 2 3 4 5 6
2026-10-07T12:04:00.000 7 8 9 10 11 12
COVARIANCE_START
EPOCH = 2026-10-07T12:00:00.000
1 2 3
COVARIANCE_STOP
"""


def test_parse_minimal():
    p = parse_oem(MINI)
    assert p["meta"]["ORIGINATOR"] == "TEST"
    [seg] = p["segments"]
    assert seg["meta"]["REF_FRAME"] == "EME2000"
    assert seg["states"][1] == [datetime(2026, 10, 7, 12, 4, tzinfo=UTC).timestamp(), 7, 8, 9, 10, 11, 12]


def test_parse_snapshot_is_plausible_iss_orbit():
    p = parse_oem(SNAP)
    states = p["segments"][0]["states"]
    assert len(states) > 1000
    steps = [round(b[0] - a[0]) for a, b in zip(states, states[1:], strict=False)]
    # Mostly 4-minute spacing, with extra samples at scheduled traffic events (dockings, departures),
    # so steps are uneven and interpolation must not assume a fixed step.
    assert all(0 < s <= 240 for s in steps)
    assert steps.count(240) / len(steps) > 0.95
    for _t, x, y, z, vx, vy, vz in states[::200]:
        alt_km = math.sqrt(x * x + y * y + z * z) - 6378.137
        speed = math.sqrt(vx * vx + vy * vy + vz * vz)
        assert 350 < alt_km < 460, alt_km
        assert 7.5 < speed < 7.8, speed


def test_rejects_wrong_frame():
    with pytest.raises(OemParseError, match="frame"):
        parse_oem(MINI.replace("EME2000", "ITRF"))


def test_rejects_garbage():
    with pytest.raises(OemParseError):
        parse_oem("hello world")


def test_window_trims_with_margin():
    p = parse_oem(SNAP)
    t0 = p["segments"][0]["states"][0][0]
    center = datetime.fromtimestamp(t0, UTC) + timedelta(hours=24)
    w = window(p, center, timedelta(hours=1), timedelta(hours=2))
    st = w["segments"][0]["states"]
    assert w["frame"] == "EME2000"
    # 3 h at 4 min = 45 intervals, plus 4 margin samples each side
    assert 50 <= len(st) <= 56
    assert st[0][0] < center.timestamp() - 3600 and st[-1][0] > center.timestamp() + 7200


def test_rejects_duplicate_or_backwards_epochs():
    dup = MINI.replace("2026-10-07T12:04:00.000 7", "2026-10-07T12:00:00.000 7")
    with pytest.raises(OemParseError, match="strictly increase"):
        parse_oem(dup)
