from app.clients.satellites import categorize, regime


def test_categorize_common_names():
    assert categorize("STARLINK-31234") == "starlink"
    assert categorize("ONEWEB-0123") == "oneweb"
    assert categorize("GPS BIIF-3  (PRN 24)") == "navigation"
    assert categorize("BEIDOU-3 M1") == "navigation"
    assert categorize("GSAT0101 (GALILEO-PFM)") == "navigation"
    assert categorize("GSAT-30") == "comms"  # Indian comsat, not Galileo
    assert categorize("NOAA 20 (JPSS-1)") == "earth"
    assert categorize("HIMAWARI-9") == "earth"
    assert categorize("HST") == "science"
    assert categorize("TIANZHOU-10") == "station"
    assert categorize("SOMETHING ELSE") == "other"


def test_regime():
    assert regime(15.5, 0.001) == "LEO"
    assert regime(2.0, 0.01) == "MEO"
    assert regime(1.0027, 0.0002) == "GEO"
    assert regime(2.0, 0.7) == "HEO"
