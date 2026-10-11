"""Build the bundled star field: frontend/public/data/stars.bin (+ stars.json metadata).

Usage (from backend/): uv run python -m app.starcat

Sources (queried once at build time, never per user):
- Yale Bright Star Catalogue, 5th ed. (VizieR V/50): every naked-eye star to V~6.5. Gaia is
  incomplete for the very brightest stars, so this is the backbone of the visible sky.
- ESA Gaia DR3 (gaia_source): fainter stars with 6.5 <= G < 7.8 for depth.

Binary layout: little-endian float32 records [x, y, z, vmag, bv] with (x, y, z) a unit vector in
J2000 equatorial coordinates mapped to scene axes (ECI x, z, -y), matching the frontend.
"""

import json
import math
import struct
import sys
from datetime import UTC, datetime

from .http import fetch
from .settings import REPO_DIR

OUT = REPO_DIR / "frontend" / "public" / "data"
VIZIER_TAP = "https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync"
GAIA_TAP = "https://gea.esac.esa.int/tap-server/tap/sync"
GAIA_MIN_G = 6.5
GAIA_MAX_G = 7.8


def tap(url: str, query: str) -> list[list]:
    params = {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "json", "QUERY": query}
    resp = fetch(url, params=params, retries=2, connect_timeout_s=15)
    return resp.json()["data"]


def scene_unit(ra_deg: float, dec_deg: float) -> tuple[float, float, float]:
    a, d = math.radians(ra_deg), math.radians(dec_deg)
    x, y, z = math.cos(d) * math.cos(a), math.cos(d) * math.sin(a), math.sin(d)
    return x, z, -y  # ECI -> scene axes


def gaia_to_v_bv(g: float, bp_rp: float | None) -> tuple[float, float]:
    """Approximate Johnson V and B-V from Gaia G and BP-RP.

    G - V uses the Evans et al. (2018, Gaia DR2) polynomial; the DR3 relation differs by 0.01-0.02 mag,
    which is irrelevant for display. B-V is a linear fit capped at 1.6 (red dwarfs/giants rarely exceed it).
    """
    c = 0.8 if bp_rp is None else bp_rp
    v = g + 0.01760 + 0.006860 * c + 0.1732 * c * c  # G - V = -0.0176 - 0.00686 c - 0.1732 c^2
    return v, max(-0.4, min(1.6, 0.8 * c - 0.05))


def main() -> int:
    bsc = tap(VIZIER_TAP, 'SELECT RAJ2000, DEJ2000, Vmag, "B-V" FROM "V/50/catalog" WHERE Vmag IS NOT NULL')
    gaia = tap(
        GAIA_TAP,
        "SELECT ra, dec, phot_g_mean_mag, bp_rp FROM gaiadr3.gaia_source "
        f"WHERE phot_g_mean_mag >= {GAIA_MIN_G} AND phot_g_mean_mag < {GAIA_MAX_G}",
    )
    records = []
    for ra, dec, vmag, bv in bsc:
        if ra is None or dec is None:
            continue
        records.append((*scene_unit(ra, dec), float(vmag), 0.6 if bv is None else float(bv)))
    # The Bright Star Catalogue reaches V~7.9 for some stars, overlapping the Gaia range: drop Gaia
    # sources within 20 arcsec of a BSC star so nothing is drawn twice (which would look too bright).
    cell = 0.5  # degrees
    grid: dict[tuple[int, int], list[tuple[float, float, float]]] = {}
    for ra, dec, _v, _bv in bsc:
        if ra is not None and dec is not None:
            grid.setdefault((int(dec // cell), int(ra // cell)), []).append(scene_unit(ra, dec))
    cos_lim = math.cos(math.radians(20 / 3600))
    duplicates = 0
    for ra, dec, g, bp_rp in gaia:
        u = scene_unit(ra, dec)
        near = (
            w
            for dd in (-1, 0, 1)
            for dr in (-1, 0, 1)
            for w in grid.get((int(dec // cell) + dd, (int(ra // cell) + dr) % int(360 / cell)), [])
        )
        if any(u[0] * w[0] + u[1] * w[1] + u[2] * w[2] > cos_lim for w in near):
            duplicates += 1
            continue
        v, bv = gaia_to_v_bv(float(g), bp_rp)
        records.append((*u, v, bv))
    records.sort(key=lambda r: r[3])  # brightest first

    OUT.mkdir(parents=True, exist_ok=True)
    with (OUT / "stars.bin").open("wb") as f:
        for r in records:
            f.write(struct.pack("<5f", *r))
    meta = {
        "count": len(records),
        "bright_star_catalogue": len(bsc),
        "gaia_dr3": len(gaia) - duplicates,
        "gaia_duplicates_of_bsc_removed": duplicates,
        "gaia_g_range": [GAIA_MIN_G, GAIA_MAX_G],
        "record": ["x", "y", "z", "vmag", "bv"],
        "frame": "J2000 equatorial unit vectors in scene axes (ECI x, z, -y)",
        "generated_at": datetime.now(UTC).isoformat(),
        "attribution": (
            "Stars: Yale Bright Star Catalogue (Hoffleit & Warren 1991, via CDS VizieR V/50) and "
            "ESA Gaia DR3 (ESA/Gaia/DPAC, CC BY-SA 3.0 IGO)."
        ),
    }
    (OUT / "stars.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(
        f"wrote {len(records):,} stars ({len(bsc):,} BSC + {len(gaia) - duplicates:,} Gaia; "
        f"{duplicates} duplicates dropped)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
