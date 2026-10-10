"""CCSDS OEM (text) parser for NASA's public ISS ephemeris.

States are EME2000 (J2000) position in km and velocity in km/s, epochs in UTC. Interpolation happens
in the frontend; the backend only parses and trims to a time window.
"""

from datetime import UTC, datetime, timedelta


class OemParseError(ValueError):
    pass


def _epoch(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=UTC)


def parse_oem(text: str) -> dict:
    """Return {"meta", "segments": [{"meta", "states": [[t_unix_s, x, y, z, vx, vy, vz], ...]}]}."""
    header: dict[str, str] = {}
    segments: list[dict] = []
    seg: dict | None = None
    in_meta = in_cov = False
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("COMMENT"):
            continue
        if line == "META_START":
            seg, in_meta = {"meta": {}, "states": []}, True
            segments.append(seg)
            continue
        if line == "META_STOP":
            in_meta = False
            continue
        if line == "COVARIANCE_START":
            in_cov = True
            continue
        if line == "COVARIANCE_STOP":
            in_cov = False
            continue
        if in_cov:
            continue
        if "=" in line:
            k, v = (p.strip() for p in line.split("=", 1))
            (seg["meta"] if in_meta and seg is not None else header)[k] = v
            continue
        parts = line.split()
        if seg is None or len(parts) < 7:
            raise OemParseError(f"unexpected line: {line[:60]}")
        try:
            t = _epoch(parts[0]).timestamp()
            seg["states"].append([t, *(float(p) for p in parts[1:7])])
        except ValueError as exc:
            raise OemParseError(f"bad state line: {line[:60]}") from exc
    for s in segments:
        times = [st[0] for st in s["states"]]
        if any(b <= a for a, b in zip(times, times[1:], strict=False)):
            raise OemParseError(
                "epochs must strictly increase within a segment (interpolation would divide by zero)"
            )
    if not segments or not any(s["states"] for s in segments):
        raise OemParseError("no ephemeris states found")
    for s in segments:
        frame, tsys = s["meta"].get("REF_FRAME"), s["meta"].get("TIME_SYSTEM")
        if frame not in ("EME2000", "J2000") or tsys != "UTC":
            raise OemParseError(f"unsupported frame/time system: {frame}/{tsys}")
    return {"meta": header, "segments": segments}


def window(parsed: dict, center: datetime, before: timedelta, after: timedelta) -> dict:
    """Keep states in [center - before, center + after], plus 4 margin samples per side (8-point stencil)."""
    lo, hi = (center - before).timestamp(), (center + after).timestamp()
    out = []
    for seg in parsed["segments"]:
        st = seg["states"]
        idx = [i for i, s in enumerate(st) if lo <= s[0] <= hi]
        if not idx:
            continue
        a, b = max(idx[0] - 4, 0), min(idx[-1] + 5, len(st))
        out.append({"meta": seg["meta"], "states": st[a:b]})
    return {
        "meta": parsed["meta"],
        "frame": "EME2000",
        "units": {"pos": "km", "vel": "km/s"},
        "segments": out,
    }
