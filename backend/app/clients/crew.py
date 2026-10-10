"""Normalize Launch Library 2 active expeditions into a crew-by-station list."""

# LL2 station names -> our station ids (see clients/stations.py)
STATION_IDS = {"International Space Station": "iss", "Tiangong space station": "tiangong"}


def _crew_member(c: dict) -> dict:
    a = c.get("astronaut") or {}
    agency = a.get("agency") or {}
    nat = a.get("nationality") or []
    return {
        "name": a.get("name"),
        "agency": agency.get("abbrev") or agency.get("name"),
        "agency_name": agency.get("name"),
        "nationality": (nat[0].get("nationality_name") if nat and isinstance(nat[0], dict) else None),
        "role": (c.get("role") or {}).get("role"),
    }


def crew_by_station(expeditions: dict) -> list[dict]:
    out = []
    for exp in expeditions.get("results", []):
        station = exp.get("spacestation") or {}
        crew = [_crew_member(c) for c in exp.get("crew", [])]
        out.append(
            {
                "station_id": STATION_IDS.get(station.get("name")),
                "station": station.get("name"),
                "expedition": exp.get("name"),
                "start": exp.get("start"),
                "crew": [c for c in crew if c["name"]],
            }
        )
    return out
