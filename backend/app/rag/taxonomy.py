"""Transparent heuristics that connect what users say to OSM categories.

These tables describe OUR categories, not facts about individual places: e.g. "a park is a quiet
place" is a property of the category and is used only as a soft ranking signal. Nothing here is
ever presented to the user as a fact about a specific POI.
"""
from typing import Literal, get_args

from app.integrations.osm_categories import CATEGORIES

CategoryKey = Literal[
    "attraction", "museum", "park", "monument", "theatre", "library", "gallery", "architecture",
    "viewpoint", "cafe", "restaurant", "mall", "playground", "public_space", "sports", "promenade",
]
assert set(get_args(CategoryKey)) == set(CATEGORIES), "CategoryKey is out of sync with osm_categories"

Interest = Literal[
    "beautiful", "photo", "unusual", "culture", "history", "nature", "quiet", "active", "kids",
    "food", "coffee", "shopping", "architecture", "art", "relax", "romantic",
]

# interest -> category -> weight (0..1)
AFFINITY: dict[str, dict[str, float]] = {
    "beautiful": {"attraction": 1, "viewpoint": 1, "architecture": 0.9, "monument": 0.8, "park": 0.8, "public_space": 0.8, "promenade": 0.8},
    "photo": {"viewpoint": 1, "architecture": 1, "monument": 0.9, "attraction": 0.9, "public_space": 0.7, "promenade": 0.7, "park": 0.6},
    "unusual": {"attraction": 0.9, "architecture": 0.8, "gallery": 0.8, "monument": 0.6, "museum": 0.6},
    "culture": {"museum": 1, "theatre": 1, "gallery": 1, "library": 0.7, "monument": 0.5, "architecture": 0.5},
    "history": {"monument": 1, "museum": 0.9, "architecture": 0.7, "attraction": 0.5},
    "nature": {"park": 1, "promenade": 0.8, "viewpoint": 0.5, "playground": 0.3},
    "quiet": {"park": 1, "library": 0.8, "gallery": 0.7, "promenade": 0.7, "museum": 0.6, "cafe": 0.4, "public_space": 0.3},
    "active": {"sports": 1, "park": 0.6, "promenade": 0.6},
    "kids": {"playground": 1, "park": 0.8, "attraction": 0.6, "museum": 0.4, "mall": 0.4},
    "food": {"restaurant": 1, "cafe": 0.8, "mall": 0.3},
    "coffee": {"cafe": 1, "restaurant": 0.2},
    "shopping": {"mall": 1},
    "architecture": {"architecture": 1, "monument": 0.7, "attraction": 0.6, "public_space": 0.5},
    "art": {"gallery": 1, "museum": 0.8, "theatre": 0.7, "monument": 0.6},
    "relax": {"park": 1, "promenade": 0.8, "cafe": 0.6, "public_space": 0.5, "library": 0.4},
    "romantic": {"viewpoint": 0.9, "promenade": 0.8, "park": 0.7, "cafe": 0.6, "restaurant": 0.6, "architecture": 0.5},
}

# Used when the user states no interest at all ("Where should I go?"): sightseeing first.
DEFAULT_AFFINITY: dict[str, float] = {
    "attraction": 0.8, "monument": 0.7, "viewpoint": 0.8, "architecture": 0.7, "park": 0.7,
    "public_space": 0.6, "promenade": 0.6, "museum": 0.6, "gallery": 0.5, "theatre": 0.4,
}

NOISY_CATEGORIES = {"mall", "sports", "restaurant"}
FREE_LIKELY_CATEGORIES = {"park", "monument", "public_space", "promenade", "viewpoint", "playground", "architecture"}
COMMERCIAL_CATEGORIES = {"cafe", "restaurant", "mall", "theatre", "sports"}

# Typical time people spend; a rough category-level estimate, always flagged as an estimate.
VISIT_MINUTES: dict[str, int] = {
    "attraction": 20, "museum": 60, "park": 30, "monument": 10, "theatre": 120, "library": 30,
    "gallery": 40, "architecture": 10, "viewpoint": 15, "cafe": 40, "restaurant": 60, "mall": 60,
    "playground": 30, "public_space": 20, "sports": 60, "promenade": 30,
}

# metres per minute, used only to turn a time budget into a search radius and a rough ETA
SPEED_M_PER_MIN = {"walk": 80, "bike": 250, "car": 400, "transit": 300}
DETOUR_FACTOR = 1.3  # straight line -> typical street distance; an estimate, not a route
