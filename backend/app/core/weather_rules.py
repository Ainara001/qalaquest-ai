"""Walking-comfort rules for Astana Weather Mode.

These thresholds are QalaQuest's own comfort heuristics for planning a walk, NOT official hazard criteria
(official warnings come from Kazhydromet and are not integrated). Override with WEATHER_RULES='{"wind_ms": 12}'.
"""
import json
import logging
from functools import lru_cache

from app.core.config import get_settings

log = logging.getLogger("weather_rules")

DEFAULT_RULES: dict[str, float] = {
    "wind_ms": 10.0,             # sustained wind at 10 m considered uncomfortable for a long walk
    "gust_ms": 15.0,             # gusts
    "cold_apparent_c": -5.0,     # "feels like" at or below → cold
    "very_cold_apparent_c": -15.0,
    "hot_apparent_c": 30.0,
    "wet_probability_pct": 60.0,  # forecast precipitation probability
    "wet_mm_h": 0.3,              # current/forecast precipitation intensity
    # longest comfortable time outdoors (walking + outdoor visits) per condition, minutes
    "cap_windy_min": 30.0,
    "cap_cold_min": 30.0,
    "cap_very_cold_min": 15.0,
    "cap_wet_min": 20.0,
    "cap_hot_min": 40.0,
}


@lru_cache
def rules() -> dict[str, float]:
    r = dict(DEFAULT_RULES)
    raw = get_settings().weather_rules
    if raw:
        try:
            r.update({k: float(v) for k, v in json.loads(raw).items() if k in r})
        except (ValueError, TypeError):
            log.warning("WEATHER_RULES is not valid JSON; using defaults")
    return r
