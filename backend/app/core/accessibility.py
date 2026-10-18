"""Accessibility status of a POI from its real OSM tags (stage 7).

Entrance/place and the way to it are separate:
- entrance: from `wheelchair` on the POI (yes/designated → confirmed, limited → partial, no → not accessible,
  missing → unknown). `wheelchair=yes` is NOT read as "there is a ramp".
- path: never "confirmed". Routes use Valhalla's wheelchair profile, but kerbs, steps and surfaces are sparse in OSM,
  so the way is always reported as "not verified as barrier-free".
- facts: only tags that exist on this object (ramp, ramp:wheelchair, wheelchair:description, toilets:wheelchair, elevator…).
"""
from typing import Literal

EntranceStatus = Literal["confirmed", "partial", "no", "unknown"]
FACT_TAGS = ("ramp", "ramp:wheelchair", "wheelchair:description", "wheelchair:description:ru", "toilets:wheelchair",
             "elevator", "entrance", "step_count", "handrail", "automatic_door", "door")


def entrance_status(wheelchair: str | None) -> EntranceStatus:
    return {"yes": "confirmed", "designated": "confirmed", "limited": "partial", "no": "no"}.get((wheelchair or "").strip(), "unknown")


def accessibility(wheelchair: str | None, tags: dict | None) -> dict:
    tags = tags or {}
    return {
        "entrance": entrance_status(wheelchair or tags.get("wheelchair")),
        "path": "not_verified",
        "facts": [f"{k}={str(tags[k])[:80]}" for k in FACT_TAGS if tags.get(k)],
        "source": "openstreetmap",
    }
