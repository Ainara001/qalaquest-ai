"""Ranking configuration. Weights can be overridden with RANKING_WEIGHTS='{"interest": 0.3}' (JSON);
they are re-normalised to sum to 1. Clients can never send weights."""
import json
import logging
from functools import lru_cache

from app.core.config import get_settings

log = logging.getLogger("ranking")

DEFAULT_WEIGHTS: dict[str, float] = {
    "semantic": 0.20,   # similarity of the POI document to the request text
    "interest": 0.25,   # profile / session / mood interests vs category, tags and taste vector
    "location": 0.15,   # proximity to the start point within the radius
    "time": 0.10,       # how comfortably getting there + a typical visit fits the time budget
    "budget": 0.05,     # soft fit to the budget (prices are not in the data)
    "context": 0.10,    # favourite categories, indoor/outdoor, company
    "feedback": 0.10,   # learned from likes / dislikes on cards
    "data": 0.05,       # how much verified information the source has
    "weather": 0.10,    # indoor/outdoor fit to the current weather assessment (neutral without weather)
}

# Multipliers applied after the weighted sum (soft, never re-admit filtered places).
VISITED_MULTIPLIER = 0.6        # "already been here" while looking for new places
CLOSED_MULTIPLIER = 0.35        # parseable OSM hours say the place is closed when the user would arrive
NOT_INTERESTED_MULTIPLIER = 0.4  # "not interesting" on this exact place
DIVERSITY_DISCOUNT = 0.85        # per already chosen place of the same category


@lru_cache
def weights() -> dict[str, float]:
    w = dict(DEFAULT_WEIGHTS)
    raw = get_settings().ranking_weights
    if raw:
        try:
            for k, v in json.loads(raw).items():
                if k in w and isinstance(v, (int, float)) and v >= 0:
                    w[k] = float(v)
        except ValueError:
            log.warning("RANKING_WEIGHTS is not valid JSON; using defaults")
    total = sum(w.values()) or 1.0
    return {k: v / total for k, v in w.items()}
