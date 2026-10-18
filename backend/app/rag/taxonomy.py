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
    # profile interests added in stage 4
    "parks", "museums", "family", "sport", "culture_events", "free",
]

# The 16 interests a user can pick in the profile (subset of Interest).
ProfileInterest = Literal[
    "architecture", "history", "art", "nature", "parks", "photo", "coffee", "food", "museums",
    "unusual", "family", "sport", "quiet", "active", "culture_events", "free",
]

Mood = Literal["relax", "adventure", "inspiration", "unusual", "active", "quiet", "photo", "family", "just_walk"]

# A mood is a temporary set of weighted interests for the current walk only.
MOOD_INTERESTS: dict[str, dict[str, float]] = {
    "relax": {"relax": 1, "parks": 0.8, "quiet": 0.6, "coffee": 0.5},
    "adventure": {"unusual": 1, "active": 0.7, "beautiful": 0.5},
    "inspiration": {"art": 1, "architecture": 0.8, "culture": 0.7},
    "unusual": {"unusual": 1, "art": 0.5},
    "active": {"active": 1, "sport": 0.8, "parks": 0.5},
    "quiet": {"quiet": 1, "parks": 0.7},
    "photo": {"photo": 1, "beautiful": 0.8, "architecture": 0.6},
    "family": {"family": 1, "parks": 0.6},
    "just_walk": {"parks": 0.8, "beautiful": 0.6},
}

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
    "parks": {"park": 1, "promenade": 0.7, "public_space": 0.4},
    "museums": {"museum": 1, "gallery": 0.6},
    "family": {"playground": 1, "park": 0.8, "attraction": 0.6, "museum": 0.4, "mall": 0.3},
    "sport": {"sports": 1, "park": 0.4},
    "culture_events": {"theatre": 1, "gallery": 0.7, "museum": 0.5, "library": 0.4},
    "free": {"park": 0.6, "public_space": 0.6, "monument": 0.6, "promenade": 0.6, "viewpoint": 0.6, "architecture": 0.5},
}

# Real OSM tags that support an interest (a match is shown in "why recommended" as a fact).
INTEREST_TAGS: dict[str, list[tuple[str, tuple[str, ...] | None]]] = {
    "architecture": [("architect", None), ("building:architecture", None), ("heritage", None), ("building", ("cathedral", "mosque", "church", "temple", "synagogue"))],
    "history": [("historic", None), ("heritage", None), ("memorial", None)],
    "art": [("artwork_type", None), ("artist_name", None), ("tourism", ("artwork", "gallery"))],
    "nature": [("natural", None), ("leisure", ("park", "garden", "nature_reserve"))],
    "photo": [("tourism", ("viewpoint", "artwork"))],
    "coffee": [("cuisine", ("coffee_shop",))],
    "food": [("cuisine", None)],
    "museums": [("tourism", ("museum",))],
    "family": [("leisure", ("playground",)), ("kids_area", ("yes",)), ("changing_table", ("yes",))],
    "kids": [("leisure", ("playground",)), ("kids_area", ("yes",))],
    "sport": [("sport", None)],
    "active": [("sport", None)],
    "culture_events": [("amenity", ("theatre", "arts_centre"))],
    "free": [("fee", ("no",))],
}

# Short multilingual descriptions; their embeddings form the semantic "taste" vector of a profile.
INTEREST_PHRASES: dict[str, str] = {
    "architecture": "architecture, notable buildings / архитектура, здания / сәулет, ғимараттар",
    "history": "history, monuments, memorials / история, памятники / тарих, ескерткіштер",
    "art": "art, sculpture, gallery / искусство, скульптура, галерея / өнер, мүсін",
    "nature": "nature, greenery, trees / природа, зелень / табиғат, жасыл аймақ",
    "parks": "park, garden, square / парк, сквер / саябақ",
    "photo": "scenic photo spot, view / красивое место для фото / суретке түсетін әдемі жер",
    "coffee": "coffee shop / кофейня / кофехана",
    "food": "restaurant, local food / ресторан, еда / мейрамхана, тағам",
    "museums": "museum, exhibition / музей, выставка / мұражай, көрме",
    "unusual": "unusual, unique place / необычное место / ерекше орын",
    "family": "family, children, playground / семья, дети, детская площадка / отбасы, балалар",
    "sport": "sport, stadium, active / спорт, стадион / спорт",
    "quiet": "quiet calm place / тихое спокойное место / тыныш орын",
    "active": "active walk, sport / активная прогулка / белсенді серуен",
    "culture_events": "theatre, concert, culture / театр, концерт, культура / театр, мәдениет",
    "free": "public space, free access / общественное пространство / қоғамдық кеңістік",
}

# Category-level heuristics for indoor/outdoor preference (about the category, not the place).
INDOOR_CATEGORIES = {"museum", "theatre", "library", "gallery", "mall", "cafe", "restaurant"}
OUTDOOR_CATEGORIES = {"park", "monument", "viewpoint", "public_space", "promenade", "playground", "architecture"}

PACE_SPEED_M_PER_MIN = {"slow": 60, "normal": 80, "active": 100}
# Soft budget fit for categories where people usually pay; no prices exist in the data.
BUDGET_COMMERCIAL_FIT = {"2000": 0.3, "5000": 0.6, "10000": 0.8, "any": 1.0}

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
