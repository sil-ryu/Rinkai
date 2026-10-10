from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_DIR / ".env", BACKEND_DIR / ".env"), env_file_encoding="utf-8", extra="ignore"
    )

    nasa_api_key: str = "DEMO_KEY"
    ll2_api_key: str = ""
    # Production LL2: with the 30 min crew TTL this is ~2 req/hour, well under the ~15/hour free limit.
    ll2_base_url: str = "https://ll.thespacedevs.com/2.3.0"
    cache_dir: Path = REPO_DIR / "data" / "cache"
    snapshot_dir: Path = REPO_DIR / "data" / "snapshots"
    offline: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
