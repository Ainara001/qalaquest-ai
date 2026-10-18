"""Minimal Overpass API client: sequential requests, retry with backoff, mirror fallback."""
import logging
import time

import httpx

log = logging.getLogger("overpass")

DEFAULT_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
RETRYABLE_STATUS = {429, 500, 502, 503, 504}


class OverpassError(RuntimeError):
    pass


class OverpassClient:
    def __init__(
        self,
        endpoints: list[str] | None = None,
        user_agent: str = "QalaQuestAI/0.2 (hackathon project)",
        max_attempts: int = 5,
        backoff_base: float = 5.0,
        client_timeout: float = 180.0,
    ):
        self.endpoints = endpoints or DEFAULT_ENDPOINTS
        self.max_attempts = max_attempts
        self.backoff_base = backoff_base
        self._http = httpx.Client(timeout=client_timeout, headers={"User-Agent": user_agent})

    def close(self) -> None:
        self._http.close()

    def query(self, ql: str) -> dict:
        """Run a query, retrying temporary failures. Raises OverpassError when all attempts fail."""
        last_error = "unknown"
        for attempt in range(1, self.max_attempts + 1):
            endpoint = self.endpoints[(attempt - 1) % len(self.endpoints)]
            delay = self.backoff_base * 2 ** (attempt - 1)
            try:
                resp = self._http.post(endpoint, data={"data": ql})
                if resp.status_code in RETRYABLE_STATUS:
                    last_error = f"HTTP {resp.status_code} from {endpoint}"
                    retry_after = resp.headers.get("Retry-After")
                    if retry_after and retry_after.isdigit():
                        delay = max(delay, int(retry_after))
                elif resp.status_code != 200:
                    raise OverpassError(f"HTTP {resp.status_code} from {endpoint}: {resp.text[:200]}")
                else:
                    try:
                        data = resp.json()
                    except ValueError:
                        # Overpass answers with an HTML error page when it is overloaded.
                        last_error = f"non-JSON response from {endpoint}"
                    else:
                        remark = str(data.get("remark", ""))
                        if "runtime error" in remark or "out of memory" in remark:
                            last_error = f"server-side error: {remark[:150]}"
                        else:
                            return data
            except httpx.HTTPError as exc:
                last_error = f"{type(exc).__name__} from {endpoint}"

            if attempt < self.max_attempts:
                log.warning("overpass attempt %d/%d failed (%s); retrying in %.0fs", attempt, self.max_attempts, last_error, delay)
                time.sleep(delay)
        raise OverpassError(f"all {self.max_attempts} attempts failed: {last_error}")
