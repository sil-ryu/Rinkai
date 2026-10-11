"""Refresh the bundled offline snapshots in data/snapshots/ from the live sources.

Usage (from backend/): uv run python -m app.snapshots [source_key ...]
Run it occasionally by hand, not on a schedule: Launch Library 2 allows ~15 requests/hour.
"""

import json
import sys
from datetime import UTC, datetime

from .http import UpstreamError
from .service import snapshot_meta_path
from .settings import get_settings
from .sources import ALL_SOURCES, fetch_source


def main(keys: list[str]) -> int:
    settings = get_settings()
    failed = 0
    for src in ALL_SOURCES:
        if keys and src.key not in keys:
            continue
        if not keys and src.provider == "CelesTrak":
            # CelesTrak firewalls clients that download too often; only refresh it when named explicitly.
            print(f"skip {src.key}: CelesTrak is only refreshed when named (max once a day)")
            continue
        try:
            resp = fetch_source(src, settings)
            body = resp.content
            src.validate(
                body if src.kind == "bytes" else json.loads(body) if src.kind == "json" else body.decode()
            )
        except (UpstreamError, ValueError, KeyError, TypeError) as exc:
            print(f"FAIL {src.key}: {exc}")
            failed += 1
            continue
        path = settings.snapshot_dir / src.snapshot
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(resp.content)
        meta = {"fetched_at": datetime.now(UTC).isoformat(), "url": str(resp.url).split("?")[0]}
        snapshot_meta_path(path).write_text(json.dumps(meta), encoding="utf-8")
        print(f"ok   {src.key}: {len(resp.content):,} bytes -> {path.relative_to(settings.snapshot_dir)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
