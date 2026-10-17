"""Hybrid retrieval: SQL hard filters -> vector + keyword + geo signals -> weighted rerank -> diverse pick.

Hard constraints (radius, categories, fee, accessibility, excluded ids, time budget) are applied BEFORE
ranking. At the current scale (about a thousand POIs) similarities are computed exactly for every
filtered row; the HNSW index in `poi_index` is there for when an ANN pre-selection becomes necessary.
"""
import re
from dataclasses import dataclass, field

from sqlalchemy import Float, and_, cast, func, literal, or_, select
from sqlalchemy.orm import Session

from app.models import Poi, PoiIndex
from app.rag.embeddings import EmbeddingService
from app.rag.taxonomy import (
    AFFINITY, COMMERCIAL_CATEGORIES, DEFAULT_AFFINITY, DETOUR_FACTOR, FREE_LIKELY_CATEGORIES,
    NOISY_CATEGORIES, SPEED_M_PER_MIN, VISIT_MINUTES,
)

WEIGHTS = {"semantic": 0.30, "keyword": 0.10, "affinity": 0.30, "proximity": 0.20, "data": 0.10}
MAX_ROWS = 1500
CITY_CENTER = (51.1282, 71.4304)  # Baiterek; used only as an explicit, reported fallback


@dataclass
class SearchSpec:
    query_text: str | None = None
    anchor: tuple[float, float] | None = None  # (lat, lon)
    radius_m: int = 2000
    include_categories: list[str] = field(default_factory=list)
    exclude_categories: list[str] = field(default_factory=list)
    interests: list[str] = field(default_factory=list)
    free_only: bool = False
    wheelchair: bool = False
    quiet: bool = False
    exclude_ids: set[int] = field(default_factory=set)
    time_minutes: int | None = None
    transport: str = "walk"
    limit: int = 8


@dataclass
class Candidate:
    poi: Poi
    distance_m: float | None
    semantic: float  # normalised 0..1 within the candidate set
    keyword: float
    affinity: float
    proximity: float
    data: float
    final: float
    raw_similarity: float


def walk_minutes(distance_m: float, transport: str = "walk") -> int:
    return max(1, round(distance_m * DETOUR_FACTOR / SPEED_M_PER_MIN[transport]))


def radius_for_time(time_minutes: int, transport: str) -> int:
    """Straight-line radius reachable within about a third of the time budget (heuristic, documented)."""
    travel_min = max(5, min(time_minutes * 0.35, 45))
    return int(travel_min * SPEED_M_PER_MIN[transport] / DETOUR_FACTOR)


def _data_score(p: Poi) -> float:
    has = [
        bool(p.name_ru or p.name_kk), bool(p.opening_hours), bool(p.address),
        bool(p.website or p.phone), bool(p.description or p.description_ru or p.description_kk),
    ]
    return sum(has) / len(has)


def _tsquery(text: str | None) -> str | None:
    tokens = [t for t in re.findall(r"[^\W_]{3,}", (text or "").lower())][:8]
    return " | ".join(dict.fromkeys(tokens)) or None


def _affinity(p: Poi, spec: SearchSpec) -> float:
    cat = p.category
    if spec.interests:
        weights = sorted((AFFINITY[i].get(cat, 0.0) for i in spec.interests), reverse=True)
        score = weights[0] + 0.1 * sum(1 for w in weights[1:] if w >= 0.5)
    elif spec.include_categories:
        score = 1.0
    else:
        score = DEFAULT_AFFINITY.get(cat, 0.2)
    if spec.quiet and cat in NOISY_CATEGORIES:
        score -= 0.3
    if spec.free_only:
        fee = (p.tags or {}).get("fee")
        if fee == "no":
            score += 0.3
        elif cat in FREE_LIKELY_CATEGORIES:
            score += 0.15
        elif cat in COMMERCIAL_CATEGORIES:
            score -= 0.3
    return max(0.0, min(1.0, score))


def retrieve(db: Session, emb: EmbeddingService, spec: SearchSpec) -> tuple[list[Candidate], int]:
    """Returns (ranked candidates, number of rows that passed the hard filters)."""
    q_text = (spec.query_text or "").strip() or None
    q_vec = emb.embed_query(q_text) if q_text else None

    origin = None
    if spec.anchor:
        origin = func.ST_SetSRID(func.ST_MakePoint(spec.anchor[1], spec.anchor[0]), 4326).cast(Poi.geom.type)
    dist = func.ST_Distance(Poi.geom, origin) if origin is not None else literal(None)
    sim = (1 - PoiIndex.embedding.cosine_distance(q_vec)) if q_vec is not None else literal(0.0)
    tsq = _tsquery(q_text)
    kw = (
        func.ts_rank_cd(PoiIndex.tsv, func.to_tsquery("russian", tsq))
        if tsq
        else literal(0.0)
    )

    # unnamed objects are only useful when the user is looking for playgrounds / is with children
    unnamed_ok = "kids" in spec.interests or "playground" in spec.include_categories
    where = [or_(Poi.name.is_not(None), and_(Poi.category == "playground", literal(unnamed_ok)))]
    if origin is not None:
        where.append(func.ST_DWithin(Poi.geom, origin, spec.radius_m))
    if spec.include_categories:
        where.append(Poi.category.in_(spec.include_categories))
    if spec.exclude_categories:
        where.append(Poi.category.not_in(spec.exclude_categories))
    if spec.free_only:  # hard: never offer something the source marks as paid
        where.append(or_(Poi.tags["fee"].astext.is_(None), Poi.tags["fee"].astext != "yes"))
    if spec.wheelchair:
        where.append(Poi.wheelchair.in_(("yes", "designated")))
    if spec.exclude_ids:
        where.append(Poi.id.not_in(spec.exclude_ids))

    stmt = (
        select(Poi, dist.label("d"), cast(sim, Float).label("s"), cast(kw, Float).label("k"))
        .join(PoiIndex, PoiIndex.poi_id == Poi.id)
        .where(and_(*where))
        .order_by(dist if origin is not None else Poi.id)
        .limit(MAX_ROWS)
    )
    rows = db.execute(stmt).all()

    # hard time budget: getting there + at least half of the typical visit must fit
    if spec.time_minutes:
        kept = []
        for p, d, s, k in rows:
            travel = walk_minutes(d, spec.transport) if d is not None else 0
            if travel + VISIT_MINUTES.get(p.category, 20) * 0.5 <= spec.time_minutes:
                kept.append((p, d, s, k))
        rows = kept
    total = len(rows)
    if not rows:
        return [], 0

    sims = [r[2] for r in rows]
    lo, hi = min(sims), max(sims)
    kmax = max((r[3] for r in rows), default=0) or 1.0
    out: list[Candidate] = []
    for p, d, s, k in rows:
        semantic = (s - lo) / (hi - lo) if (q_vec is not None and hi - lo > 1e-6) else 0.0
        keyword = k / kmax if kmax else 0.0
        aff = _affinity(p, spec)
        prox = max(0.0, 1 - d / spec.radius_m) if d is not None else 0.5
        data = _data_score(p)
        final = (
            WEIGHTS["semantic"] * semantic + WEIGHTS["keyword"] * keyword + WEIGHTS["affinity"] * aff
            + WEIGHTS["proximity"] * prox + WEIGHTS["data"] * data
        )
        out.append(Candidate(p, d, semantic, keyword, aff, prox, data, final, s))
    out.sort(key=lambda c: c.final, reverse=True)
    # relevance floor: with explicit interests, drop categories unrelated to them if enough relevant places exist
    if spec.interests:
        relevant = [c for c in out if c.affinity >= 0.3]
        if len(relevant) >= 3:
            out = relevant
    return diversify(out, spec.limit, spec), total


def diversify(ranked: list[Candidate], n: int, spec: SearchSpec) -> list[Candidate]:
    """Greedy pick that discounts repeated categories so results are not near-identical."""
    chosen: list[Candidate] = []
    pool = ranked[:80]
    explicit = bool(spec.include_categories) and len(spec.include_categories) == 1
    while pool and len(chosen) < n:
        def adjusted(c: Candidate) -> float:
            if explicit:
                return c.final
            same = sum(1 for x in chosen if x.poi.category == c.poi.category)
            return c.final * (0.85**same)

        best = max(pool, key=adjusted)
        pool.remove(best)
        names = {(x.poi.name or "").casefold() for x in chosen}
        if best.poi.name and best.poi.name.casefold() in names:
            continue  # same-named place already chosen (e.g. chain outlet next door)
        chosen.append(best)
    return chosen
