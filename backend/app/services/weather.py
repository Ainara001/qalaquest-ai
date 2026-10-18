"""WeatherService: real weather from Open-Meteo (no key), cached, with a comfort assessment for a walk.

Never invents data: if Open-Meteo is unreachable and nothing is cached, WeatherUnavailable is raised and
callers continue without weather adaptation (and say so).
"""
import asyncio
import logging
import time
from datetime import datetime, timezone

import httpx

from app.core.config import get_settings
from app.core.weather_rules import rules
from app.schemas.weather import WeatherAssessment, WeatherHour, WeatherNow, WeatherReport

log = logging.getLogger("weather")
ASTANA = (51.1282, 71.4304)
STALE_MAX_S = 3600  # serve cached data up to 1 h old if a refresh fails (flagged as stale)


class WeatherUnavailable(Exception):
    pass


def summary_code(code: int | None) -> str:
    """WMO weather interpretation code → short machine code."""
    if code is None:
        return "unknown"
    if code == 0:
        return "clear"
    if code in (1, 2):
        return "partly_cloudy"
    if code == 3:
        return "cloudy"
    if code in (45, 48):
        return "fog"
    if 51 <= code <= 57:
        return "drizzle"
    if 61 <= code <= 67 or 80 <= code <= 82:
        return "rain"
    if 71 <= code <= 77 or code in (85, 86):
        return "snow"
    if code >= 95:
        return "thunderstorm"
    return "unknown"


def assess(now: WeatherNow, hours: list[WeatherHour], window_minutes: int) -> WeatherAssessment:
    r = rules()
    n_hours = max(1, -(-window_minutes // 60))
    window = hours[:n_hours]

    def vals(attr: str, include_now: bool = True) -> list[float]:
        v = [getattr(h, attr) for h in window if getattr(h, attr) is not None]
        nv = getattr(now, attr, None)
        return v + ([nv] if include_now and nv is not None else [])

    wind = max(vals("wind_ms"), default=None)
    gusts = max(vals("gusts_ms"), default=None)
    apparent = min(vals("apparent_c"), default=None)
    prob = max((h.precipitation_probability_pct for h in window if h.precipitation_probability_pct is not None), default=None)
    precip = max(vals("precipitation_mm"), default=None)

    conds: list[str] = []
    if (wind is not None and wind >= r["wind_ms"]) or (gusts is not None and gusts >= r["gust_ms"]):
        conds.append("windy")
    if apparent is not None and apparent <= r["very_cold_apparent_c"]:
        conds.append("very_cold")
    elif apparent is not None and apparent <= r["cold_apparent_c"]:
        conds.append("cold")
    if apparent is not None and apparent >= r["hot_apparent_c"]:
        conds.append("hot")
    if (prob is not None and prob >= r["wet_probability_pct"]) or (precip is not None and precip >= r["wet_mm_h"]):
        conds.append("wet")
    caps = [int(r[f"cap_{c}_min"]) for c in conds]
    level = "comfortable" if not conds else "indoor_preferred" if ("very_cold" in conds or "wet" in conds or len(conds) >= 2) else "caution"
    return WeatherAssessment(
        level=level, conditions=conds or ["comfortable"], outdoor_cap_min=min(caps) if caps else None,
        basis="current+forecast" if window else "current", window_minutes=window_minutes,
        max_wind_ms=wind, max_gusts_ms=gusts, min_apparent_c=apparent, max_precipitation_probability_pct=prob,
    )


class WeatherService:
    def __init__(self) -> None:
        s = get_settings()
        self._url, self._timeout, self._ttl = s.weather_url, s.weather_timeout_s, s.weather_cache_s
        self._cache: dict[tuple[float, float], tuple[float, dict, datetime]] = {}
        self._lock = asyncio.Lock()

    async def _raw(self, lat: float, lon: float) -> tuple[dict, datetime, bool]:
        # ~5 km grid: neighbours share one cached response, so we do not hammer the API
        key = (round(lat * 20) / 20, round(lon * 20) / 20)
        now = time.monotonic()
        hit = self._cache.get(key)
        if hit and now - hit[0] < self._ttl:
            return hit[1], hit[2], False
        params = {
            "latitude": key[0], "longitude": key[1], "timezone": "Asia/Almaty", "wind_speed_unit": "ms", "forecast_hours": 12,
            "current": "temperature_2m,apparent_temperature,wind_speed_10m,wind_gusts_10m,precipitation,weather_code",
            "hourly": "temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,weather_code",
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                for attempt in (1, 2):  # Open-Meteo sometimes answers 503 "overloaded" for a moment
                    resp = await client.get(self._url, params=params)
                    if resp.status_code in (429, 500, 502, 503, 504) and attempt == 1:
                        await asyncio.sleep(1.5)
                        continue
                    break
                resp.raise_for_status()
                data = resp.json()
            if "current" not in data:
                raise ValueError("no current block")
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("open-meteo failed: %s", type(exc).__name__)
            if hit and now - hit[0] < STALE_MAX_S:
                return hit[1], hit[2], True
            raise WeatherUnavailable() from None
        fetched = datetime.now(timezone.utc)
        async with self._lock:
            self._cache[key] = (now, data, fetched)
        return data, fetched, False

    async def report(self, lat: float = ASTANA[0], lon: float = ASTANA[1], window_minutes: int = 60) -> WeatherReport:
        data, fetched, stale = await self._raw(lat, lon)
        c, h = data["current"], data.get("hourly", {})
        now = WeatherNow(
            time_local=c.get("time", ""), temperature_c=c.get("temperature_2m"), apparent_c=c.get("apparent_temperature"),
            wind_ms=c.get("wind_speed_10m"), gusts_ms=c.get("wind_gusts_10m"), precipitation_mm=c.get("precipitation"),
            weather_code=c.get("weather_code"), summary=summary_code(c.get("weather_code")),
        )
        times = h.get("time", [])

        def col(name: str, i: int):
            v = h.get(name) or []
            return v[i] if i < len(v) else None

        # forecast hours from the current hour on (the hourly block starts at the current hour)
        start = next((i for i, t in enumerate(times) if t[:13] >= now.time_local[:13]), 0)
        hours = [
            WeatherHour(
                time_local=times[i], temperature_c=col("temperature_2m", i), apparent_c=col("apparent_temperature", i),
                precipitation_probability_pct=col("precipitation_probability", i), precipitation_mm=col("precipitation", i),
                wind_ms=col("wind_speed_10m", i), gusts_ms=col("wind_gusts_10m", i), weather_code=col("weather_code", i),
                summary=summary_code(col("weather_code", i)),
            )
            for i in range(start, len(times))
        ]
        return WeatherReport(
            source="open-meteo", latitude=data.get("latitude", lat), longitude=data.get("longitude", lon),
            timezone=data.get("timezone", "Asia/Almaty"), utc_offset_seconds=data.get("utc_offset_seconds", 18000),
            fetched_at=fetched, stale=stale, current=now, forecast=hours[:12], assessment=assess(now, hours, window_minutes),
        )


_weather: WeatherService | None = None


def get_weather() -> WeatherService:
    global _weather
    if _weather is None:
        _weather = WeatherService()
    return _weather
