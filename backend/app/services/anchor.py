"""Resolve a place name mentioned by the user ("near Mega Silk Way") to a real POI of the database."""
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import Poi

MIN_SIMILARITY = 0.35
# on a tie prefer big, well-known place types over e.g. a cafe sharing the name
CATEGORY_PRIORITY = ["mall", "attraction", "park", "museum", "theatre", "monument", "architecture", "public_space", "sports"]


def find_anchor(db: Session, name: str) -> Poi | None:
    q = name.strip()
    if len(q) < 2:
        return None
    cols = [Poi.name, Poi.name_ru, Poi.name_kk, Poi.name_en]
    sim = func.greatest(*[func.coalesce(func.similarity(func.lower(c), q.lower()), 0) for c in cols])
    contains = or_(*[c.ilike(f"%{q.replace('%', r'\%').replace('_', r'\_')}%") for c in cols])
    rows = db.execute(
        select(Poi, sim.label("sim"), contains.label("contains"))
        .where(or_(contains, sim >= MIN_SIMILARITY))
        .order_by(sim.desc())
        .limit(15)
    ).all()
    if not rows:
        return None

    def rank(row) -> tuple:
        poi, s, c = row
        prio = CATEGORY_PRIORITY.index(poi.category) if poi.category in CATEGORY_PRIORITY else len(CATEGORY_PRIORITY)
        return (-round(float(s), 1), not c, prio)

    return min(rows, key=rank)[0]
