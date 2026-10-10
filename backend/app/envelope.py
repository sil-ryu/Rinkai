from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

DataOrigin = Literal["live", "cache", "snapshot"]


class Envelope(BaseModel):
    """Every /api response: the data plus where it came from and how old it is."""

    source: DataOrigin
    fetched_at: datetime
    provider: str
    attribution: str
    data: Any
