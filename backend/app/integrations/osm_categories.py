"""Mapping of OpenStreetMap tags to QalaQuest categories.

Rules are evaluated in order; the FIRST matching rule wins, so more specific
categories (museum, theatre...) come before generic ones (attraction, park).
The same rules produce the Overpass selectors and classify the returned
elements, so the query and the classification can never drift apart.
"""
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Rule:
    category: str
    # Tag conditions that must ALL hold: key -> allowed values (None = key present).
    tags: dict[str, tuple[str, ...] | None]
    subcategory: str | None = None  # None = use the matched value of the first tag
    require_name: bool = True
    exclude: dict[str, tuple[str, ...]] = field(default_factory=dict)


RULES: list[Rule] = [
    Rule("museum", {"tourism": ("museum",)}),
    Rule("theatre", {"amenity": ("theatre",)}),
    Rule("library", {"amenity": ("library",)}),
    Rule("gallery", {"tourism": ("gallery",)}),
    Rule("viewpoint", {"tourism": ("viewpoint",)}),
    Rule("mall", {"shop": ("mall",)}),
    Rule("attraction", {"tourism": ("attraction",)}),
    Rule("monument", {"historic": ("monument", "memorial")}),
    Rule("monument", {"tourism": ("artwork",)}, subcategory="artwork"),
    Rule("architecture", {"historic": ("building", "castle", "ruins", "fort")}),
    Rule("architecture", {"building": ("cathedral", "mosque", "church", "temple", "synagogue")}, subcategory="worship"),
    Rule("architecture", {"man_made": ("tower",)}, subcategory="tower"),
    Rule("park", {"leisure": ("park", "garden")}),
    Rule("playground", {"leisure": ("playground",)}, require_name=False),
    Rule("public_space", {"place": ("square",)}),
    Rule("public_space", {"highway": ("pedestrian",), "area": ("yes",)}, subcategory="pedestrian_area"),
    Rule("sports", {"leisure": ("stadium", "sports_centre", "ice_rink", "swimming_pool")}),
    Rule("promenade", {"highway": ("pedestrian",)}, subcategory="pedestrian_street"),
    Rule("promenade", {"man_made": ("pier",)}),
    Rule("promenade", {"natural": ("beach",)}),
    Rule("cafe", {"amenity": ("cafe",)}),
    Rule("restaurant", {"amenity": ("restaurant",)}),
]

CATEGORIES: list[str] = list(dict.fromkeys(r.category for r in RULES))

# Labels are used by the API to let free-text search match a category name.
# The UI has its own copy in the frontend locale files.
CATEGORY_LABELS: dict[str, dict[str, str]] = {
    "attraction": {"ru": "Достопримечательности", "kk": "Көрікті жерлер"},
    "museum": {"ru": "Музеи", "kk": "Мұражайлар"},
    "park": {"ru": "Парки и скверы", "kk": "Саябақтар мен скверлер"},
    "monument": {"ru": "Памятники", "kk": "Ескерткіштер"},
    "theatre": {"ru": "Театры", "kk": "Театрлар"},
    "library": {"ru": "Библиотеки", "kk": "Кітапханалар"},
    "gallery": {"ru": "Галереи", "kk": "Галереялар"},
    "architecture": {"ru": "Архитектурные объекты", "kk": "Сәулет нысандары"},
    "viewpoint": {"ru": "Смотровые площадки", "kk": "Көрініс алаңдары"},
    "cafe": {"ru": "Кафе и кофейни", "kk": "Кафелер мен кофеханалар"},
    "restaurant": {"ru": "Рестораны", "kk": "Мейрамханалар"},
    "mall": {"ru": "Торгово-развлекательные центры", "kk": "Сауда-ойын-сауық орталықтары"},
    "playground": {"ru": "Детские площадки", "kk": "Балалар алаңдары"},
    "public_space": {"ru": "Общественные пространства", "kk": "Қоғамдық кеңістіктер"},
    "sports": {"ru": "Спортивные объекты", "kk": "Спорт нысандары"},
    "promenade": {"ru": "Прогулочные зоны", "kk": "Серуендеу аймақтары"},
}


def classify(tags: dict[str, str]) -> tuple[str, str | None, bool] | None:
    """Return (category, subcategory, require_name) for the first matching rule."""
    for rule in RULES:
        if all(k in tags and (v is None or tags[k] in v) for k, v in rule.tags.items()):
            if any(tags.get(k) in v for k, v in rule.exclude.items()):
                continue
            first_key = next(iter(rule.tags))
            return rule.category, rule.subcategory or tags[first_key], rule.require_name
    return None


def overpass_selectors(category: str) -> list[str]:
    """Overpass tag filters for all rules of a category, e.g. ['["tourism"~"^(museum)$"]']."""
    out = []
    for rule in RULES:
        if rule.category != category:
            continue
        parts = []
        for key, values in rule.tags.items():
            parts.append(f'["{key}"]' if values is None else f'["{key}"~"^({"|".join(values)})$"]')
        if rule.require_name:
            parts.append('["name"]')
        out.append("".join(parts))
    return out
