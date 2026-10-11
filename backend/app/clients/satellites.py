"""Build the satellite swarm catalogue from CelesTrak (preferred) or SatNOGS (fallback).

Categories come from well-known naming conventions, so they are a best-effort grouping, not an
authoritative classification; unknown names fall into "other". Owner countries come from SatNOGS
metadata where available.
"""

import re

# The crewed stations are drawn as detailed models, not swarm points.
EXCLUDE = {25544, 48274}

CATEGORIES: list[tuple[str, re.Pattern[str]]] = [
    (
        "station",
        re.compile(
            r"\b(ISS|CSS|TIANHE|WENTIAN|MENGTIAN|SHENZHOU|TIANZHOU|SOYUZ|PROGRESS|DRAGON|CYGNUS|HTV)\b"
        ),
    ),
    ("starlink", re.compile(r"STARLINK")),
    ("oneweb", re.compile(r"ONEWEB")),
    ("broadband", re.compile(r"KUIPER|QIANFAN|GUOWANG|HULIANWANG|SATNET|LYNK|AST SPACEMOBILE|BLUEBIRD")),
    (
        "navigation",
        re.compile(r"GPS|NAVSTAR|GLONASS|GALILEO|GSAT0\d|BEIDOU|QZS|IRNSS|NVS-|COSMOS 2[45]\d\d \(\d+\)"),
    ),
    (
        "earth",
        re.compile(
            r"NOAA|GOES|METEOSAT|METOP|HIMAWARI|FENGYUN|FY-|SENTINEL|LANDSAT|\bTERRA\b|\bAQUA\b|SUOMI|JPSS|GCOM|ELEKTRO|"
            r"METEOR|INSAT|GAOFEN|\bSPOT\b|PLEIADES|WORLDVIEW|ALOS|RESURS|KANOPUS|DMSP|CARTOSAT|RESOURCESAT|OCEANSAT|"
            r"\bFLOCK\b|\bDOVE\b|SKYSAT|LEMUR|ICEYE|CAPELLA|YAOGAN|JILIN|SUPERVIEW|EOS-|HAIYANG|CBERS|KOMPSAT|GOSAT|SWOT"
        ),
    ),
    (
        "comms",
        re.compile(
            r"INTELSAT|\bSES\b|SES-|EUTELSAT|ASTRA|IRIDIUM|GLOBALSTAR|ORBCOMM|INMARSAT|VIASAT|ECHOSTAR|TELSTAR|"
            r"ZHONGXING|CHINASAT|TIANLIAN|TDRS|LUCH|EXPRESS|YAMAL|GSAT|JCSAT|BSAT|SKYNET|ARABSAT|NILESAT|THAICOM|"
            r"AMAZONAS|HISPASAT|TURKSAT|KOREASAT|APSTAR|ASIASAT|O3B|MUOS|WGS|AEHF|SIRIUS|\bXM-|GALAXY|SXM|DIRECTV"
        ),
    ),
    (
        "science",
        re.compile(
            r"\bHST\b|HUBBLE|CHANDRA|\bCXO\b|\bSWIFT\b|\bFERMI\b|NUSTAR|\bTESS\b|\bXMM\b|\bINTEGRAL\b|HXMT|EINSTEIN|XRISM|SOHO|\bSDO\b|\bIRIS\b|"
            r"\bAIM\b|\bICON\b|DAMPE|CSES|ASO-S|SVOM|NEOSSAT|CHEOPS|IXPE|SPEKTR"
        ),
    ),
]

CATEGORY_LABELS = {
    "station": "Crew & cargo vehicles",
    "starlink": "Starlink",
    "oneweb": "OneWeb",
    "broadband": "Other broadband constellations",
    "navigation": "Navigation (GPS, GLONASS, Galileo, BeiDou, QZSS, NavIC)",
    "earth": "Earth observation & weather",
    "comms": "Communications",
    "science": "Science",
    "other": "Other / unclassified",
}


def categorize(name: str) -> str:
    n = name.upper()
    for cat, rx in CATEGORIES:
        if rx.search(n):
            return cat
    return "other"


def regime(mean_motion_rev_day: float, ecc: float) -> str:
    """Orbit regime from mean motion (rev/day) and eccentricity."""
    if ecc > 0.25:
        return "HEO"
    if mean_motion_rev_day > 11.25:
        return "LEO"
    if 0.9 < mean_motion_rev_day < 1.1:
        return "GEO"
    return "MEO"


def _countries(satnogs_sats: list[dict] | None) -> dict[int, str]:
    out: dict[int, str] = {}
    for s in satnogs_sats or []:
        if s.get("norad_cat_id") and s.get("countries"):
            out[int(s["norad_cat_id"])] = s["countries"]
    return out


def _tle_mean_motion(tle2: str) -> tuple[float, float]:
    return float(tle2[52:63]), float("0." + tle2[26:33].strip())


def from_celestrak(omm: list[dict], satnogs_sats: list[dict] | None) -> list[dict]:
    cc = _countries(satnogs_sats)
    keep = [
        "OBJECT_NAME",
        "OBJECT_ID",
        "EPOCH",
        "MEAN_MOTION",
        "ECCENTRICITY",
        "INCLINATION",
        "RA_OF_ASC_NODE",
        "ARG_OF_PERICENTER",
        "MEAN_ANOMALY",
        "EPHEMERIS_TYPE",
        "CLASSIFICATION_TYPE",
        "NORAD_CAT_ID",
        "ELEMENT_SET_NO",
        "REV_AT_EPOCH",
        "BSTAR",
        "MEAN_MOTION_DOT",
        "MEAN_MOTION_DDOT",
    ]
    out = []
    for r in omm:
        norad = int(r["NORAD_CAT_ID"])
        if norad in EXCLUDE:
            continue
        name = str(r.get("OBJECT_NAME", ""))
        out.append(
            {
                "id": norad,
                "name": name,
                "cat": categorize(name),
                "orbit": regime(float(r["MEAN_MOTION"]), float(r["ECCENTRICITY"])),
                "cc": cc.get(norad, ""),
                "omm": {k: r[k] for k in keep if k in r},
            }
        )
    return out


def from_satnogs(tles: list[dict], satnogs_sats: list[dict] | None) -> list[dict]:
    cc = _countries(satnogs_sats)
    out = []
    seen: set[int] = set()
    for r in tles:
        norad = int(r["norad_cat_id"])
        if norad in EXCLUDE or norad in seen:
            continue
        seen.add(norad)
        name = str(r.get("tle0", "")).removeprefix("0 ").strip()
        try:
            mm, ecc = _tle_mean_motion(r["tle2"])
        except (ValueError, IndexError):
            continue
        out.append(
            {
                "id": norad,
                "name": name,
                "cat": categorize(name),
                "orbit": regime(mm, ecc),
                "cc": cc.get(norad, ""),
                "tle": [r["tle1"], r["tle2"]],
            }
        )
    return out
