"""WeatherService: real weather from Open-Meteo (no key), cached, with a comfort assessment for a walk.

Never invents data: if Open-Meteo is unreachable and nothing is cached, WeatherUnavailable is raised and
callers continue without weather adaptation (and say so).
"""
import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone

import httpx

from app.core.config import get_settings
from app.core.weather_rules import rules
from app.schemas.weather import WeatherAssessment, WeatherHour, WeatherNow, WeatherReport

log = logging.getLogger("weather")
ASTANA = (51.1282, 71.4304)
STALE_MAX_S = 3600  # serve cached data up to 1 h old if a refresh fails (flagged as stale)
RETRY_AFTER_FAILURE_S = 60  # after a failed call, answer "unavailable" at once for a minute instead of waiting again


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


MET_URL = "https://api.met.no/weatherapi/locationforecast/2.0/complete"
ALMATY_OFFSET = timedelta(hours=5)  # Astana: UTC+5 (Asia/Almaty); also what Open-Meteo reports for the zone


def met_summary(symbol: str | None) -> str:
    """MET Norway symbol_code (e.g. "lightrainshowers_day") → the same short codes as the WMO mapping."""
    if not symbol:
        return "unknown"
    base = symbol.split("_")[0]
    if base == "clearsky":
        return "clear"
    if base in ("fair", "partlycloudy"):
        return "partly_cloudy"
    if base == "cloudy":
        return "cloudy"
    if base == "fog":
        return "fog"
    if "thunder" in base:
        return "thunderstorm"
    if "snow" in base or "sleet" in base:
        return "snow"
    if "rain" in base:
        return "drizzle" if base.startswith("lightrain") and "showers" not in base else "rain"
    return "unknown"


def _local(iso_utc: str) -> str:
    return (datetime.fromisoformat(iso_utc.replace("Z", "+00:00")) + ALMATY_OFFSET).strftime("%Y-%m-%dT%H:%M")


def normalize_met(data: dict, lat: float, lon: float) -> dict:
    """MET Norway locationforecast → the Open-Meteo-like shape used by WeatherService.report()."""
    ts = data["properties"]["timeseries"][:14]
    if not ts:
        raise ValueError("empty timeseries")

    def pick(entry: dict) -> dict:
        d = entry["data"]["instant"]["details"]
        nxt = (entry["data"].get("next_1_hours") or {})
        return {
            "time": _local(entry["time"]), "temperature_2m": d.get("air_temperature"),
            "apparent_temperature": d.get("apparent_air_temperature", d.get("air_temperature")),
            "wind_speed_10m": d.get("wind_speed"), "wind_gusts_10m": d.get("wind_speed_of_gust"),
            "precipitation": (nxt.get("details") or {}).get("precipitation_amount"),
            "precipitation_probability": (nxt.get("details") or {}).get("probability_of_precipitation"),
            "summary": met_summary((nxt.get("summary") or {}).get("symbol_code")),
        }

    rows = [pick(e) for e in ts]
    hourly = {k: [r[k] for r in rows] for k in rows[0]}
    meta = data.get("geometry", {}).get("coordinates", [lon, lat])
    return {"latitude": meta[1], "longitude": meta[0], "timezone": "Asia/Almaty", "utc_offset_seconds": 18000,
            "current": rows[0], "hourly": hourly, "_source": "met.no"}


class WeatherService:
    """Real weather with a provider chain: Open-Meteo first, MET Norway when it fails.

    Cloud hosts often share outbound IPs that Open-Meteo throttles, so a second independent provider keeps the
    weather available. Provider errors (HTTP status only) are kept in `status()` for diagnosis.
    """

    def __init__(self) -> None:
        s = get_settings()
        self._url, self._timeout, self._ttl = s.weather_url, s.weather_timeout_s, s.weather_cache_s
        self._cache: dict[tuple[float, float], tuple[float, dict, datetime]] = {}
        self._failed_at: dict[tuple[float, float], float] = {}
        self._last: dict[str, dict] = {}
        self._lock = asyncio.Lock()

    def status(self) -> dict:
        return {"providers": self._last, "cache_seconds": self._ttl}

    def _note(self, provider: str, ok: bool, detail: str) -> None:
        self._last[provider] = {"ok": ok, "detail": detail, "at": datetime.now(timezone.utc).isoformat()}

    async def _open_meteo(self, client: httpx.AsyncClient, key: tuple[float, float]) -> dict:
        params = {
            "latitude": key[0], "longitude": key[1], "timezone": "Asia/Almaty", "wind_speed_unit": "ms", "forecast_hours": 12,
            "current": "temperature_2m,apparent_temperature,wind_speed_10m,wind_gusts_10m,precipitation,weather_code",
            "hourly": "temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,weather_code",
        }
        for attempt in (1, 2):  # Open-Meteo sometimes answers 503 "overloaded" for a moment
            resp = await client.get(self._url, params=params)
            if resp.status_code in (429, 500, 502, 503, 504) and attempt == 1:
                await asyncio.sleep(1.0)
                continue
            break
        resp.raise_for_status()
        data = resp.json()
        if "current" not in data:
            raise ValueError("no current block")
        data["current"]["summary"] = summary_code(data["current"].get("weather_code"))
        h = data.get("hourly", {})
        h["summary"] = [summary_code(c) for c in (h.get("weather_code") or [])]
        data["_source"] = "open-meteo"
        return data

    async def _met(self, client: httpx.AsyncClient, key: tuple[float, float]) -> dict:
        # api.met.no requires an identifying User-Agent (terms of service)
        resp = await client.get(MET_URL, params={"lat": round(key[0], 4), "lon": round(key[1], 4)},
                                headers={"User-Agent": "QalaQuestAI/0.6 github.com/Ainara001/qalaquest-ai"})
        resp.raise_for_status()
        return normalize_met(resp.json(), key[0], key[1])

    async def _raw(self, lat: float, lon: float) -> tuple[dict, datetime, bool]:
        # ~5 km grid: neighbours share one cached response, so we do not hammer the APIs
        key = (round(lat * 20) / 20, round(lon * 20) / 20)
        now = time.monotonic()
        hit = self._cache.get(key)
        if hit and now - hit[0] < self._ttl:
            return hit[1], hit[2], False
        # the map asks for weather on every context change: after a failure, do not block each request on a timeout
        if now - self._failed_at.get(key, -RETRY_AFTER_FAILURE_S) < RETRY_AFTER_FAILURE_S:
            if hit and now - hit[0] < STALE_MAX_S:
                return hit[1], hit[2], True
            raise WeatherUnavailable()
        data = None
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            for name, fetch in (("open-meteo", self._open_meteo), ("met.no", self._met)):
                try:
                    data = await fetch(client, key)
                    self._note(name, True, "ok")
                    break
                except httpx.HTTPStatusError as exc:
                    self._note(name, False, f"HTTP {exc.response.status_code}")
                except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
                    self._note(name, False, type(exc).__name__)
                log.warning("weather provider %s failed: %s", name, self._last[name]["detail"])
        if data is None:
            self._failed_at[key] = now
            if hit and now - hit[0] < STALE_MAX_S:
                return hit[1], hit[2], True
            raise WeatherUnavailable()
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
            weather_code=c.get("weather_code"), summary=c.get("summary") or "unknown",
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
                summary=col("summary", i) or "unknown",
            )
            for i in range(start, len(times))
        ]
        source = data.get("_source", "open-meteo")
        return WeatherReport(
            source=source, latitude=data.get("latitude", lat), longitude=data.get("longitude", lon),
            timezone=data.get("timezone", "Asia/Almaty"), utc_offset_seconds=data.get("utc_offset_seconds", 18000),
            fetched_at=fetched, stale=stale, current=now, forecast=hours[:12], assessment=assess(now, hours, window_minutes),
            attribution=ATTRIBUTION[source],
        )


ATTRIBUTION = {
    "open-meteo": "Weather data by Open-Meteo.com (CC BY 4.0)",
    "met.no": "Weather data from MET Norway (CC BY 4.0)",
}


_weather: WeatherService | None = None


def get_weather() -> WeatherService:
    global _weather
    if _weather is None:
        _weather = WeatherService()
    return _weather
