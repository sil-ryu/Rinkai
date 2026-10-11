"""File-backed TTL cache. Entries survive restarts so the rate-limited sources aren't re-fetched."""

import contextlib
import json
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class CacheEntry:
    fetched_at: datetime
    payload: Any

    def age_s(self, now: datetime) -> float:
        return (now - self.fetched_at).total_seconds()


class FileCache:
    def __init__(self, root: Path):
        self.root = root

    def _path(self, key: str) -> Path:
        return self.root / f"{re.sub(r'[^A-Za-z0-9_.-]', '_', key)}.json"

    def get(self, key: str) -> CacheEntry | None:
        path = self._path(key)
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            bin_ref = raw.get("bin")
            if isinstance(bin_ref, str):
                payload = (self.root / bin_ref).read_bytes()
            elif bin_ref:  # older format: a single "<key>.bin" next to the JSON
                payload = path.with_suffix(".bin").read_bytes()
            else:
                payload = raw["payload"]
            return CacheEntry(datetime.fromisoformat(raw["fetched_at"]), payload)
        except (FileNotFoundError, PermissionError, ValueError, KeyError, TypeError):
            # Anything unreadable is a cache miss, never a server error.
            return None

    def set(self, key: str, payload: Any, fetched_at: datetime | None = None) -> CacheEntry:
        entry = CacheEntry(fetched_at or datetime.now(UTC), payload)
        self.root.mkdir(parents=True, exist_ok=True)
        path = self._path(key)
        # Unique temp name per write: concurrent writers must not share a temp file.
        tmp = path.with_name(f"{path.stem}.{uuid.uuid4().hex}.tmp")
        bin_name = None
        if isinstance(payload, bytes):
            # Each binary payload gets its own file, named in the metadata, so the JSON never points
            # at a stale or half-written image. Older files for this key are removed afterwards.
            bin_name = f"{path.stem}.{uuid.uuid4().hex}.bin"
            (self.root / bin_name).write_bytes(payload)
        stamp = entry.fetched_at.isoformat()
        meta = {"fetched_at": stamp, "bin": bin_name, "payload": None if bin_name else payload}
        tmp.write_text(json.dumps(meta), encoding="utf-8")
        try:
            tmp.replace(path)
        except PermissionError:
            # Windows refuses to replace a file another thread is reading or replacing.
            # The other writer's data is equally fresh, so dropping this write is fine.
            tmp.unlink(missing_ok=True)
            if bin_name:
                (self.root / bin_name).unlink(missing_ok=True)
            return entry
        if bin_name:
            for old in self.root.glob(f"{path.stem}.*.bin"):
                if old.name != bin_name:
                    with contextlib.suppress(PermissionError):  # still being read; removed later
                        old.unlink()
        return entry
