import os
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import http as http_mod
from app import service as service_mod
from app.main import app
from app.settings import REPO_DIR, Settings, get_settings

SNAPSHOTS = REPO_DIR / "data" / "snapshots"


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(http_mod.time, "sleep", lambda s: None)


@pytest.fixture(autouse=True)
def reset_failure_cooldowns():
    service_mod._last_failure.clear()
    yield
    service_mod._last_failure.clear()


@pytest.fixture
def snapshot_dir(tmp_path: Path) -> Path:
    dst = tmp_path / "snapshots"
    shutil.copytree(SNAPSHOTS, dst)
    return dst


@pytest.fixture
def settings(tmp_path: Path, snapshot_dir: Path) -> Settings:
    return Settings(
        _env_file=None,
        cache_dir=tmp_path / "cache",
        snapshot_dir=snapshot_dir,
        offline=False,
        ll2_base_url="https://ll.example.test/2.3.0",
    )


@pytest.fixture
def client_for():
    def make(s: Settings) -> TestClient:
        app.dependency_overrides[get_settings] = lambda: s
        return TestClient(app)

    yield make
    app.dependency_overrides.clear()


def pytest_collection_modifyitems(config, items):
    if os.environ.get("RINKAI_NETWORK_TESTS") == "1":
        return
    skip = pytest.mark.skip(reason="network test; set RINKAI_NETWORK_TESTS=1 to run")
    for item in items:
        if "network" in item.keywords:
            item.add_marker(skip)
