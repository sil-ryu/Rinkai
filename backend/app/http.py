"""Outbound HTTP with explicit timeouts and retry/backoff on transient failures only."""

import logging
import re
import time

import httpx

log = logging.getLogger("rinkai.http")

READ_TIMEOUT_S = 20.0
USER_AGENT = "Rinkai/0.1 (hobby space-sim; cached proxy)"
_SECRET_PARAM = re.compile(r"(api_key|key|token)=[^&\s]+", re.IGNORECASE)


class UpstreamError(Exception):
    pass


def redact(url: str) -> str:
    return _SECRET_PARAM.sub(r"\1=REDACTED", url)


def fetch(
    url: str,
    *,
    params: dict | None = None,
    headers: dict | None = None,
    retries: int = 2,
    connect_timeout_s: float = 5.0,
    backoff_s: float = 0.5,
    client: httpx.Client | None = None,
) -> httpx.Response:
    """GET with retries on timeouts, transport errors and 5xx. 4xx fails immediately."""
    own = client is None
    client = client or httpx.Client(
        timeout=httpx.Timeout(READ_TIMEOUT_S, connect=connect_timeout_s), follow_redirects=True
    )
    hdrs = {"User-Agent": USER_AGENT, **(headers or {})}
    try:
        for attempt in range(retries + 1):
            try:
                resp = client.get(url, params=params, headers=hdrs)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                reason = type(exc).__name__
            else:
                if resp.status_code < 400:
                    return resp
                if resp.status_code < 500:
                    raise UpstreamError(f"{resp.status_code} from {redact(str(resp.url))}")
                reason = f"HTTP {resp.status_code}"
            log.warning("fetch %s failed (%s), attempt %d/%d", redact(url), reason, attempt + 1, retries + 1)
            if attempt < retries:
                time.sleep(backoff_s * 2**attempt)
        raise UpstreamError(f"{reason} from {redact(url)} after {retries + 1} attempts")
    finally:
        if own:
            client.close()
