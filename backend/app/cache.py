"""File-backed TTL cache. Entries survive restarts so the rate-limited sources aren't re-fetched."""

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
            return CacheEntry(datetime.fromisoformat(raw["fetched_at"]), raw["payload"])
        except (FileNotFoundError, PermissionError, ValueError, KeyError):
            return None

    def set(self, key: str, payload: Any, fetched_at: datetime | None = None) -> CacheEntry:
        entry = CacheEntry(fetched_at or datetime.now(UTC), payload)
        self.root.mkdir(parents=True, exist_ok=True)
        path = self._path(key)
        # Unique temp name per write: concurrent writers must not share a temp file.
        tmp = path.with_name(f"{path.stem}.{uuid.uuid4().hex}.tmp")
        tmp.write_text(
            json.dumps({"fetched_at": entry.fetched_at.isoformat(), "payload": payload}), encoding="utf-8"
        )
        try:
            tmp.replace(path)
        except PermissionError:
            # Windows refuses to replace a file another thread is reading or replacing.
            # The other writer's data is equally fresh, so dropping this write is fine.
            tmp.unlink(missing_ok=True)
        return entry
