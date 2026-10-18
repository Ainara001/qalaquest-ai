"""Hybrid, personalised retrieval.

1. SQL hard filters (radius, categories, accessibility, strict free, never-again ids, time budget).
2. Signals for every remaining row: query similarity (pgvector), keyword rank (tsvector), profile taste
   similarity, liked-places similarity, distance.
3. Explainable weighted score (weights in app.core.ranking) + feedback multipliers.
4. Diverse pick.

At about a thousand POIs similarities are computed exactly for every filtered row; the HNSW index in
`poi_index` is in place for when an ANN pre-selection becomes necessary.
"""
import re
from dataclasses import dataclass, field

from sqlalchemy import Float, and_, cast, func, literal, or_, select
from sqlalchemy.orm import Session

from datetime import datetime, timedelta, timezone

from app.core.opening_hours import status as hours_status
from app.core.ranking import CLOSED_MULTIPLIER, DIVERSITY_DISCOUNT, NOT_INTERESTED_MULTIPLIER, VISITED_MULTIPLIER, weights
from app.models import Poi, PoiIndex
from app.rag.embeddings import EmbeddingService
from app.rag.taxonomy import (
    AFFINITY, BUDGET_COMMERCIAL_FIT, COMMERCIAL_CATEGORIES, DEFAULT_AFFINITY, DETOUR_FACTOR, FREE_LIKELY_CATEGORIES,
    INDOOR_CATEGORIES, INTEREST_TAGS, NOISY_CATEGORIES, OUTDOOR_CATEGORIES, VISIT_MINUTES,
)
from app.services.personalization import PersonalContext

MAX_ROWS = 1500
CITY_CENTER = (51.1282, 71.4304)  # Baiterek; used only as an explicit, reported fallback
KIDS_FRIENDLY = {"playground", "park", "attraction", "museum", "mall"}
FRIENDS_FRIENDLY = {"cafe", "restaurant", "mall", "attraction", "sports", "public_space"}
PARTNER_FRIENDLY = {"viewpoint", "promenade", "park", "cafe", "restaurant", "architecture"}


@dataclass
class Candidate:
    poi: Poi
    distance_m: float | None
    scores: dict[str, float]
    final: float
    matched: list[tuple[str, str]] = field(default_factory=list)  # (interest, source)
    tags: list[str] = field(default_factory=list)
    feedback: list[str] = field(default_factory=list)
    favorite: bool = False
    cat_affinity: float = 0.0
    # set when the weather assessment favoured this place's category (category-level, not about the building)
    weather_fit: str | None = None  # indoor_in_adverse_weather | outdoor_in_good_weather
    open_status: str = "unknown"  # open | closed | unknown — from OSM opening_hours at the estimated arrival time


def travel_minutes(distance_m: float, speed_m_per_min: float) -> int:
    return max(1, round(distance_m * DETOUR_FACTOR / speed_m_per_min))


def _tsquery(text: str | None) -> str | None:
    tokens = [t for t in re.findall(r"[^\W_]{3,}", (text or "").lower())][:8]
    return " | ".join(dict.fromkeys(tokens)) or None


def _tag_matches(tags: dict, interest: str) -> list[str]:
    out = []
    for key, values in INTEREST_TAGS.get(interest, []):
        v = tags.get(key)
        if v is None:
            continue
        if values is None or any(x in str(v).split(";") for x in values):
            out.append(f"{key}={str(v)[:40]}")
    return out


def _norm(values: list[float]) -> tuple[float, float]:
    lo, hi = (min(values), max(values)) if values else (0.0, 0.0)
    return lo, (hi - lo) if hi - lo > 1e-6 else 0.0


def retrieve(db: Session, emb: EmbeddingService, ctx: PersonalContext, *, query_text: str | None,
             anchor: tuple[float, float] | None, limit: int, only_ids: set[int] | None = None,
             explicit: bool = False) -> tuple[list[Candidate], int]:
    """Returns (ranked diverse candidates, number of rows that passed the hard filters).

    only_ids: restrict to these POIs. explicit=True means the user picked them by hand: radius, category,
    time and "never" filters are skipped (accessibility still applies), and no diversity pruning is done.
    """
    q_text = (query_text or "").strip() or None
    q_vec = emb.embed_query(q_text) if q_text else None
    fb = ctx.feedback

    origin = func.ST_SetSRID(func.ST_MakePoint(anchor[1], anchor[0]), 4326).cast(Poi.geom.type) if anchor else None
    dist = func.ST_Distance(Poi.geom, origin) if origin is not None else literal(None)
    sim = (1 - PoiIndex.embedding.cosine_distance(q_vec)) if q_vec is not None else literal(0.0)
    psim = (1 - PoiIndex.embedding.cosine_distance(ctx.profile_vector)) if ctx.profile_vector else literal(0.0)
    fsim = (1 - PoiIndex.embedding.cosine_distance(fb.liked_vector)) if fb and fb.liked_vector else literal(0.0)
    tsq = _tsquery(q_text)
    kw = func.ts_rank_cd(PoiIndex.tsv, func.to_tsquery("russian", tsq)) if tsq else literal(0.0)

    # ---------------------------------------------------------------- hard filters
    unnamed_ok = ctx.kids or "playground" in ctx.include_categories
    where = [or_(Poi.name.is_not(None), and_(Poi.category == "playground", literal(unnamed_ok)), literal(explicit))]
    if only_ids is not None:
        where.append(Poi.id.in_(only_ids or {-1}))
    if explicit:
        if ctx.wheelchair:
            where.append(Poi.wheelchair.in_(("yes", "designated")))
        return _score(db, emb, ctx, q_text, q_vec, where, origin, dist, sim, psim, fsim, kw, limit, explicit=True)
    if origin is not None:
        where.append(func.ST_DWithin(Poi.geom, origin, ctx.radius_m))
    if ctx.include_categories:
        where.append(Poi.category.in_(ctx.include_categories))
    if ctx.exclude_categories:
        where.append(Poi.category.not_in(ctx.exclude_categories))
    fee = Poi.tags["fee"].astext
    if ctx.strict_free:
        if ctx.allow_unconfirmed_free:  # user asked to also see public spaces whose price is not stated
            where.append(or_(fee == "no", and_(Poi.category.in_(FREE_LIKELY_CATEGORIES), or_(fee.is_(None), fee != "yes"))))
        else:  # only confirmed free access
            where.append(fee == "no")
    if ctx.wheelchair:
        where.append(Poi.wheelchair.in_(("yes", "designated")))
    blocked = ctx.never_ids | ctx.exclude_ids
    if blocked:
        where.append(Poi.id.not_in(blocked))

    return _score(db, emb, ctx, q_text, q_vec, where, origin, dist, sim, psim, fsim, kw, limit)


def _score(db, emb, ctx, q_text, q_vec, where, origin, dist, sim, psim, fsim, kw, limit, explicit: bool = False):
    fb = ctx.feedback
    rows = db.execute(
        select(Poi, dist.label("d"), cast(sim, Float), cast(kw, Float), cast(psim, Float), cast(fsim, Float))
        .join(PoiIndex, PoiIndex.poi_id == Poi.id)
        .where(and_(*where))
        .order_by(dist if origin is not None else Poi.id)
        .limit(MAX_ROWS)
    ).all()

    T = ctx.time_minutes
    if T and not explicit:  # hard: getting there + at least half of a typical visit must fit (whole visit + buffer for routes)
        share, extra = (1.0, 3) if ctx.full_visit_fit else (0.5, 0)
        rows = [r for r in rows if (travel_minutes(r[1], ctx.speed_m_per_min) if r[1] is not None else 0) + VISIT_MINUTES.get(r[0].category, 20) * share + extra <= T]
    total = len(rows)
    if not rows:
        return [], 0

    s_lo, s_rng = _norm([r[2] for r in rows])
    p_lo, p_rng = _norm([r[4] for r in rows])
    f_lo, f_rng = _norm([r[5] for r in rows])
    kmax = max(r[3] for r in rows) or 1.0
    W = weights()
    strong = {i: (w, src) for i, (w, src) in ctx.interests.items() if w >= 0.45}

    out: list[Candidate] = []
    for p, d, s, k, ps, fs in rows:
        cat, tags = p.category, p.tags or {}

        # ---- interest: category affinity of weighted interests + supporting tags + taste vector
        matched, tag_facts = [], []
        if ctx.interests:
            weighted = sorted(((w * AFFINITY.get(i, {}).get(cat, 0.0), i) for i, (w, _) in ctx.interests.items()), reverse=True)
            cat_aff = weighted[0][0] + 0.1 * sum(1 for v, _ in weighted[1:] if v >= 0.45)
            for i, (w, src) in strong.items():
                t = _tag_matches(tags, i)
                if AFFINITY.get(i, {}).get(cat, 0) >= 0.5 or t:
                    matched.append((i, src))
                    tag_facts += t
            tag_bonus = 1.0 if tag_facts else 0.0
            taste = (ps - p_lo) / p_rng if p_rng else 0.0
            interest = 0.7 * min(cat_aff, 1.0) + 0.15 * tag_bonus + 0.15 * taste
            if "quiet" in strong and cat in NOISY_CATEGORIES:
                interest -= 0.3
        elif ctx.include_categories:
            cat_aff = interest = 1.0
        else:
            cat_aff = interest = DEFAULT_AFFINITY.get(cat, 0.2)

        # ---- time compatibility
        travel = travel_minutes(d, ctx.speed_m_per_min) if d is not None else 0
        if T:
            visit = VISIT_MINUTES.get(cat, 20)
            time_s = (T - travel - 0.5 * visit) / max(1.0, 0.5 * visit + 0.2 * T)
        else:
            time_s = 0.5

        # ---- budget (no prices in the data: only the OSM fee tag and a category-level heuristic)
        fee_tag = tags.get("fee")
        if fee_tag == "no":
            budget_s = 1.0
        elif ctx.strict_free:
            budget_s = 0.6  # reached only with allow_unconfirmed_free
        elif cat in COMMERCIAL_CATEGORIES:
            budget_s = BUDGET_COMMERCIAL_FIT.get(ctx.budget, 1.0)
        else:
            budget_s = 0.9 if ctx.budget != "any" else 1.0

        # ---- context: favourites, indoor/outdoor, company
        signals = []
        favorite = cat in ctx.favorite_categories
        if ctx.favorite_categories:
            signals.append(1.0 if favorite else 0.4)
        if ctx.setting == "indoor":
            signals.append(1.0 if cat in INDOOR_CATEGORIES else 0.0 if cat in OUTDOOR_CATEGORIES else 0.5)
        elif ctx.setting == "outdoor":
            signals.append(1.0 if cat in OUTDOOR_CATEGORIES else 0.0 if cat in INDOOR_CATEGORIES else 0.5)
        if ctx.company == "family":
            signals.append(1.0 if cat in KIDS_FRIENDLY else 0.3)
        elif ctx.company == "friends":
            signals.append(1.0 if cat in FRIENDS_FRIENDLY else 0.5)
        elif ctx.company == "partner":
            signals.append(1.0 if cat in PARTNER_FRIENDLY else 0.5)
        context_s = sum(signals) / len(signals) if signals else 0.5

        # ---- weather (category-level: "usually indoors / outdoors", never a claim about the building)
        weather_s = 0.5
        weather_fit = None
        if ctx.weather is not None:
            adverse = ctx.weather.level != "comfortable"
            if cat in INDOOR_CATEGORIES:
                weather_s = 1.0 if adverse else 0.6
                weather_fit = "indoor_in_adverse_weather" if adverse else None
            elif cat in OUTDOOR_CATEGORIES:
                weather_s = 0.2 if adverse else 0.9
                weather_fit = None if adverse else "outdoor_in_good_weather"

        # ---- feedback
        fb_codes: list[str] = []
        feedback_s = 0.5
        if fb:
            ca = fb.category_affinity.get(cat, 0.0)
            if ca > 0.3:  # needs at least two consistent signals (one like = 0.24)
                fb_codes.append("category_liked")
            elif ca < -0.3:
                fb_codes.append("category_disliked")
            sem = 0.0
            if fb.liked_vector is not None and f_rng:
                sem = 2 * ((fs - f_lo) / f_rng) - 1
                if sem > 0.6:
                    fb_codes.append("similar_to_liked")
            feedback_s = 0.5 + 0.5 * max(-1.0, min(1.0, 0.6 * ca + 0.4 * sem))

        has = [bool(p.name_ru or p.name_kk), bool(p.opening_hours), bool(p.address), bool(p.website or p.phone),
               bool(p.description or p.description_ru or p.description_kk)]
        sem_q = (s - s_lo) / s_rng if (q_vec is not None and s_rng) else 0.0
        scores = {
            "semantic": 0.8 * sem_q + 0.2 * (k / kmax),  # vector similarity + keyword rank
            "interest": max(0.0, min(1.0, interest)),
            "location": max(0.0, 1 - d / ctx.radius_m) if d is not None else 0.5,
            "time": max(0.0, min(1.0, time_s)),
            "budget": budget_s,
            "context": context_s,
            "feedback": feedback_s,
            "data": sum(has) / len(has),
            "weather": weather_s,
        }
        final = sum(W[n] * v for n, v in scores.items())
        # opening hours (stage 7): only parseable OSM hours count; unknown hours are neither a plus nor a minus
        arrival = datetime.now(timezone.utc) + timedelta(minutes=travel)
        open_st = hours_status(p.opening_hours, arrival)
        if open_st == "closed":
            final *= CLOSED_MULTIPLIER
        if fb and p.id in fb.visited:
            final *= VISITED_MULTIPLIER
            fb_codes.append("visited_before")
        if fb and p.id in fb.not_interested:
            final *= NOT_INTERESTED_MULTIPLIER
            fb_codes.append("marked_not_interested")
        out.append(Candidate(p, d, scores, final, matched, list(dict.fromkeys(tag_facts)), fb_codes, favorite, cat_aff, weather_fit, open_st))

    out.sort(key=lambda c: c.final, reverse=True)
    if explicit:
        return out[:limit], total
    # relevance floor: with interests, drop unrelated categories if enough related places exist
    if ctx.interests:  # categories the user liked through feedback stay relevant too
        relevant = [c for c in out if c.cat_affinity >= 0.3 or "category_liked" in c.feedback or "similar_to_liked" in c.feedback]
        if len(relevant) >= 3:
            out = relevant
    return diversify(out, limit, ctx), total


def diversify(ranked: list[Candidate], n: int, ctx: PersonalContext) -> list[Candidate]:
    """Greedy pick that discounts repeated categories so results are not near-identical."""
    chosen: list[Candidate] = []
    pool = ranked[:80]
    explicit = len(ctx.include_categories) == 1
    while pool and len(chosen) < n:
        def adjusted(c: Candidate) -> float:
            if explicit:
                return c.final
            same = sum(1 for x in chosen if x.poi.category == c.poi.category)
            return c.final * (DIVERSITY_DISCOUNT**same)

        best = max(pool, key=adjusted)
        pool.remove(best)
        if best.poi.name and best.poi.name.casefold() in {(x.poi.name or "").casefold() for x in chosen}:
            continue
        chosen.append(best)
    return chosen
