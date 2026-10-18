"""Valhalla pedestrian routing client (self-hosted, OSM Kazakhstan). Cached, with clear failure modes."""
import hashlib
import json
import logging
import time
from dataclasses import dataclass

import httpx

from app.core.config import get_settings

log = logging.getLogger("valhalla")
CACHE_TTL_S = 1800
CACHE_MAX = 500


class RoutingUnavailable(Exception):
    """The routing engine cannot be reached or failed internally."""


class NoRoute(Exception):
    """The engine works, but no pedestrian path exists between the points."""


@dataclass
class Leg:
    distance_m: float
    duration_s: float
    shape: list[list[float]]  # [[lon, lat], ...]


def decode_polyline6(encoded: str) -> list[list[float]]:
    coords, index, lat, lon = [], 0, 0, 0
    while index < len(encoded):
        for is_lon in (False, True):
            shift = result = 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if is_lon:
                lon += delta
            else:
                lat += delta
        coords.append([lon / 1e6, lat / 1e6])
    return coords


class ValhallaClient:
    def __init__(self) -> None:
        s = get_settings()
        self.base, self.timeout = s.valhalla_url.rstrip("/"), s.valhalla_timeout_s
        self._cache: dict[str, tuple[float, object]] = {}

    def _costing(self, speed_kmh: float, wheelchair: bool) -> dict:
        opts: dict = {"walking_speed": round(speed_kmh, 2)}
        if wheelchair:
            opts["type"] = "wheelchair"  # avoids steps where OSM marks them
        return {"costing": "pedestrian", "costing_options": {"pedestrian": opts}}

    async def _post(self, path: str, body: dict) -> dict:
        key = hashlib.sha256((path + json.dumps(body, sort_keys=True)).encode()).hexdigest()
        hit = self._cache.get(key)
        if hit and time.monotonic() - hit[0] < CACHE_TTL_S:
            return hit[1]  # type: ignore[return-value]
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(f"{self.base}{path}", json=body)
        except httpx.HTTPError as exc:
            log.warning("valhalla unreachable: %s", type(exc).__name__)
            raise RoutingUnavailable() from None
        if resp.status_code == 400:
            try:
                data = resp.json()
            except ValueError:
                data = {}
            # 442 no path; 171 no suitable edges near a location; 154 distance limit exceeded
            log.info("valhalla 400: error_code=%s", data.get("error_code"))
            raise NoRoute(str(data.get("error_code", "")))
        if resp.status_code != 200:
            log.warning("valhalla HTTP %s", resp.status_code)
            raise RoutingUnavailable()
        data = resp.json()
        if len(self._cache) > CACHE_MAX:
            self._cache.clear()
        self._cache[key] = (time.monotonic(), data)
        return data

    async def status(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=3) as client:
                return (await client.get(f"{self.base}/status")).status_code == 200
        except httpx.HTTPError:
            return False

    async def matrix(self, points: list[tuple[float, float]], speed_kmh: float, wheelchair: bool = False) -> list[list[tuple[float, float] | None]]:
        """All-to-all walking (distance_m, duration_s); None where no path exists."""
        locs = [{"lat": la, "lon": lo} for la, lo in points]
        data = await self._post("/sources_to_targets", {"sources": locs, "targets": locs, **self._costing(speed_kmh, wheelchair)})
        out: list[list[tuple[float, float] | None]] = []
        for row in data["sources_to_targets"]:
            out.append([
                (c["distance"] * 1000, c["time"]) if c.get("time") is not None and c.get("distance") is not None else None
                for c in row
            ])
        return out

    async def route(self, points: list[tuple[float, float]], speed_kmh: float, wheelchair: bool = False) -> list[Leg]:
        body = {
            "locations": [{"lat": la, "lon": lo, "type": "break"} for la, lo in points],
            **self._costing(speed_kmh, wheelchair),
            "directions_type": "none",
            "units": "kilometers",
        }
        data = await self._post("/route", body)
        return [
            Leg(distance_m=leg["summary"]["length"] * 1000, duration_s=leg["summary"]["time"], shape=decode_polyline6(leg["shape"]))
            for leg in data["trip"]["legs"]
        ]


_client: ValhallaClient | None = None


def get_valhalla() -> ValhallaClient:
    global _client
    if _client is None:
        _client = ValhallaClient()
    return _client
