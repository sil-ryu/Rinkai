"""Crewed stations tracked on the Live Sky globe, matched to CelesTrak OMM records by NORAD catalog number."""

TRACKED_STATIONS = {
    25544: {
        "id": "iss",
        "name": "International Space Station",
        "operator": "NASA / Roscosmos / ESA / JAXA / CSA",
    },
    48274: {"id": "tiangong", "name": "Tiangong space station", "operator": "CMSA (China)"},
}


def tracked_stations(omm_records: list[dict]) -> list[dict]:
    """Return [{"id", "name", "operator", "norad_id", "omm"}] for each tracked station present in the data."""
    by_id = {int(r["NORAD_CAT_ID"]): r for r in omm_records if "NORAD_CAT_ID" in r}
    return [
        {**info, "norad_id": norad, "omm": by_id[norad]}
        for norad, info in TRACKED_STATIONS.items()
        if norad in by_id
    ]
