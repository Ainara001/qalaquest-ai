"""Build the text that is embedded for each POI. Only real data from the source record is used."""
import hashlib

from app.integrations.osm_categories import CATEGORY_LABELS
from app.models import Poi

# OSM tags that carry real, user-relevant facts. Anything else is ignored.
TAG_LABELS = {
    "cuisine": "Cuisine",
    "sport": "Sport",
    "religion": "Religion",
    "denomination": "Denomination",
    "artwork_type": "Artwork type",
    "historic": "Historic type",
    "building": "Building type",
    "operator": "Operator",
    "brand": "Brand",
    "fee": "Fee (OSM tag)",
    "outdoor_seating": "Outdoor seating",
    "internet_access": "Internet access",
    "takeaway": "Takeaway",
    "start_date": "Start date",
    "inscription": "Inscription",
}


def build_document(p: Poi) -> str:
    names = list(dict.fromkeys(n for n in (p.name_ru, p.name_kk, p.name_en, p.name) if n))
    labels = CATEGORY_LABELS.get(p.category, {})
    lines = []
    if names:
        lines.append("Name: " + " | ".join(names))
    lines.append("Category: " + " / ".join(labels[k] for k in ("ru", "kk", "en") if k in labels))
    if p.subcategory:
        lines.append(f"Type: {p.subcategory.replace('_', ' ')}")
    for text in dict.fromkeys(d for d in (p.description_ru, p.description_kk, p.description) if d):
        lines.append(f"Description: {text[:600]}")
    tags = p.tags or {}
    for key, label in TAG_LABELS.items():
        if tags.get(key):
            lines.append(f"{label}: {str(tags[key]).replace('_', ' ')[:120]}")
    if p.address:
        lines.append(f"Address: {p.address}")
    return "\n".join(lines)


def content_hash(doc: str, model: str) -> str:
    return hashlib.sha256(f"{model}\n{doc}".encode()).hexdigest()
