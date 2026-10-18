from datetime import datetime
from typing import Literal

from pydantic import BaseModel

Condition = Literal["windy", "cold", "very_cold", "hot", "wet", "comfortable"]


class WeatherNow(BaseModel):
    time_local: str  # observation time in Astana local time (ISO, no offset)
    temperature_c: float | None
    apparent_c: float | None
    wind_ms: float | None
    gusts_ms: float | None
    precipitation_mm: float | None
    weather_code: int | None
    summary: str  # machine code (clear, cloudy, rain, snow, ...) rendered by the UI


class WeatherHour(BaseModel):
    time_local: str
    temperature_c: float | None
    apparent_c: float | None
    precipitation_probability_pct: float | None
    precipitation_mm: float | None
    wind_ms: float | None
    gusts_ms: float | None
    weather_code: int | None
    summary: str


class WeatherAssessment(BaseModel):
    """Comfort assessment for a walk window. Heuristic, not an official warning."""

    level: Literal["comfortable", "caution", "indoor_preferred"]
    conditions: list[Condition]
    outdoor_cap_min: int | None  # suggested longest time outdoors, None = no limit
    basis: Literal["current", "current+forecast"]
    window_minutes: int
    max_wind_ms: float | None
    max_gusts_ms: float | None
    min_apparent_c: float | None
    max_precipitation_probability_pct: float | None


class WeatherReport(BaseModel):
    source: str
    latitude: float
    longitude: float
    timezone: str
    utc_offset_seconds: int
    fetched_at: datetime  # UTC, when QalaQuest got the data
    stale: bool  # served from cache after a failed refresh
    current: WeatherNow
    forecast: list[WeatherHour]
    assessment: WeatherAssessment
    is_official_warning: bool = False
    attribution: str = "Weather data by Open-Meteo.com (CC BY 4.0)"
