"""PersonalizationService: merges persistent profile, today's session conditions and the current request
into one search context, and turns raw feedback into transparent ranking signals.

Priority (highest first):
1. What the user asks right now (chat text / explicit request parameters) — e.g. "no museums today".
2. Session preferences (mood, time left, today's budget, company, temporary exclusions).
3. Persistent profile (interests, favourite / disliked categories, pace, budget, duration, max distance),
   used only when the client sends use_profile=true and the request does not say "something different".
Hard requirements (accessibility, "never suggest again", explicit exclusions, strict free, max distance)
are filters and are never relaxed by soft preferences.
"""
import logging
import math
from dataclasses import dataclass, field

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Poi, PoiIndex
from app.rag.embeddings import EmbeddingService
from app.rag.taxonomy import AFFINITY, INTEREST_PHRASES, MOOD_INTERESTS, PACE_SPEED_M_PER_MIN, SPEED_M_PER_MIN
from app.schemas.ai import InterestMatch, Notice, PersonalizationInfo, QueryIntent
from app.schemas.personalization import FeedbackSummary, PersonalizationInput

log = logging.getLogger("personalization")

# feedback action -> contribution to the affinity of the place's category
FEEDBACK_WEIGHTS = {"liked": 1.0, "more_like": 2.0, "saved": 0.5, "not_interested": -1.0}
# tanh(score / SATURATION): one like gives +0.24, four likes +0.76 — no conclusion from a single click
SATURATION = 4.0
MIN_POSITIVE_FOR_VECTOR = 2  # a "taste" vector needs at least two positive signals

SOURCE_WEIGHT = {"request": 1.0, "session": 0.9, "mood": 0.9, "profile": 0.7}
# "lively" has no honest interest equivalent in our taxonomy, so it is not mapped
ATMOSPHERE_INTEREST = {"quiet": "quiet", "romantic": "romantic", "family": "family"}


@dataclass
class FeedbackModel:
    category_affinity: dict[str, float] = field(default_factory=dict)  # -1..1
    liked_vector: list[float] | None = None
    visited: set[int] = field(default_factory=set)
    not_interested: set[int] = field(default_factory=set)


@dataclass
class PersonalContext:
    # ---- hard constraints
    include_categories: list[str] = field(default_factory=list)
    exclude_categories: list[str] = field(default_factory=list)
    wheelchair: bool = False
    strict_free: bool = False
    allow_unconfirmed_free: bool = False
    never_ids: set[int] = field(default_factory=set)
    exclude_ids: set[int] = field(default_factory=set)
    time_minutes: int | None = None
    radius_m: int = 2000
    speed_m_per_min: int = 80
    transport: str = "walk"
    # ---- soft signals
    interests: dict[str, tuple[float, str]] = field(default_factory=dict)  # interest -> (weight, source)
    profile_vector: list[float] | None = None
    favorite_categories: set[str] = field(default_factory=set)
    setting: str = "any"
    budget: str = "any"
    company: str | None = None
    kids: bool = False
    feedback: FeedbackModel | None = None
    places_count: int = 3
    mood: str | None = None
    profile_used: bool = False
    ignored_by_request: bool = False
    applied: list[Notice] = field(default_factory=list)
    weather: object | None = None  # WeatherAssessment when weather mode is on
    full_visit_fit: bool = False  # routes: the whole typical visit + buffer must fit, not just half of it

    def info(self) -> PersonalizationInfo:
        return PersonalizationInfo(
            used=self.profile_used, ignored_by_request=self.ignored_by_request,
            interests=[InterestMatch(interest=i, source=src) for i, (_, src) in self.interests.items()],
            mood=self.mood, budget=self.budget, places_count=self.places_count, constraints=self.applied,
        )


_phrase_cache: dict[str, list[float]] = {}


def _interest_vector(emb: EmbeddingService, weighted: dict[str, float]) -> list[float] | None:
    """Weighted mean of the embeddings of the interests' descriptions (the semantic 'taste' of the user)."""
    vecs, ws = [], []
    for interest, w in weighted.items():
        phrase = INTEREST_PHRASES.get(interest)
        if not phrase or w <= 0:
            continue
        if interest not in _phrase_cache:
            _phrase_cache[interest] = emb.embed_query(phrase)
        vecs.append(_phrase_cache[interest])
        ws.append(w)
    if not vecs:
        return None
    v = np.average(np.array(vecs), axis=0, weights=ws)
    return (v / (np.linalg.norm(v) or 1)).tolist()


def build_feedback(db: Session, fb: FeedbackSummary) -> FeedbackModel:
    """Transparent update rule: per category, sum the action weights of rated places and squash with tanh."""
    model = FeedbackModel(visited=set(fb.visited), not_interested=set(fb.not_interested))
    rated: dict[str, list[int]] = {k: getattr(fb, k) for k in FEEDBACK_WEIGHTS}
    ids = {i for lst in rated.values() for i in lst}
    if not ids:
        return model
    cat_of = dict(db.execute(select(Poi.id, Poi.category).where(Poi.id.in_(ids))).all())
    score: dict[str, float] = {}
    for action, lst in rated.items():
        for pid in set(lst):
            if pid in cat_of:
                score[cat_of[pid]] = score.get(cat_of[pid], 0.0) + FEEDBACK_WEIGHTS[action]
    model.category_affinity = {c: math.tanh(s / SATURATION) for c, s in score.items() if s}

    positive = {pid: (2.0 if pid in set(fb.more_like) else 1.0) for pid in {*fb.liked, *fb.more_like} if pid in cat_of}
    if len(positive) >= MIN_POSITIVE_FOR_VECTOR:
        rows = db.execute(select(PoiIndex.poi_id, PoiIndex.embedding).where(PoiIndex.poi_id.in_(positive))).all()
        if len(rows) >= MIN_POSITIVE_FOR_VECTOR:
            v = np.average(np.array([np.array(e) for _, e in rows]), axis=0, weights=[positive[i] for i, _ in rows])
            model.liked_vector = (v / (np.linalg.norm(v) or 1)).tolist()
    return model


def radius_for_time(time_minutes: int, speed: int) -> int:
    """Straight-line radius reachable within ~35 % of the time budget (5–45 min), with a 1.3 detour factor."""
    travel = max(5, min(time_minutes * 0.35, 45))
    return int(travel * speed / 1.3)


class PersonalizationService:
    def __init__(self, emb: EmbeddingService) -> None:
        self.emb = emb

    def build(
        self,
        db: Session,
        *,
        p: PersonalizationInput | None,
        intent: QueryIntent | None = None,
        req_categories: list[str] | None = None,
        req_exclude: list[str] | None = None,
        req_interests: list[str] | None = None,
        req_time: int | None = None,
        req_radius: int | None = None,
        req_free: bool | None = None,
        req_children: bool | None = None,
        req_wheelchair: bool | None = None,
        transport: str | None = None,
    ) -> PersonalContext:
        p = p or PersonalizationInput()
        intent = intent or QueryIntent()
        sess = p.session
        ignore = bool(intent.ignore_preferences)
        use_profile = bool(p.use_profile and p.profile) and not ignore
        prof = p.profile if use_profile else None
        ctx = PersonalContext(profile_used=use_profile, ignored_by_request=bool(ignore and p.use_profile and p.profile))
        if ctx.ignored_by_request:
            ctx.applied.append(Notice(code="profile_ignored"))
        elif not p.use_profile and p.profile:
            ctx.applied.append(Notice(code="profile_off"))

        # ---- categories: explicit wishes beat persistent dislikes; explicit exclusions beat persistent likes
        ctx.include_categories = list(dict.fromkeys([*(req_categories or []), *intent.include_categories]))
        explicit_excl = [*(req_exclude or []), *intent.exclude_categories, *((sess.exclude_categories) if sess else [])]
        for c in dict.fromkeys(explicit_excl):
            ctx.applied.append(Notice(code="excluded_category", params={"category": c}))
        disliked = [c for c in (prof.disliked_categories if prof else []) if c not in ctx.include_categories]
        for c in disliked:
            ctx.applied.append(Notice(code="profile_disliked_category", params={"category": c}))
        ctx.exclude_categories = [c for c in dict.fromkeys([*explicit_excl, *disliked]) if c not in ctx.include_categories or c in explicit_excl]

        # ---- accessibility and "never again": requirements, always applied
        ctx.wheelchair = bool(p.wheelchair or req_wheelchair or intent.wheelchair)
        if ctx.wheelchair:
            ctx.applied.append(Notice(code="wheelchair_required"))
        if p.feedback and p.feedback.never:
            ctx.never_ids = set(p.feedback.never)
            ctx.applied.append(Notice(code="never_excluded", params={"count": len(ctx.never_ids)}))

        # ---- budget: request > session > profile
        intent_budget = {"free": "free", "low": "2000"}.get(intent.budget or "")
        ctx.budget = (
            ("free" if req_free else None) or intent_budget or (sess.budget if sess else None)
            or (prof.budget if prof else None) or "any"
        )
        ctx.strict_free = ctx.budget == "free"
        ctx.allow_unconfirmed_free = bool(sess and sess.allow_unconfirmed_free)
        if ctx.strict_free:
            ctx.applied.append(Notice(code="free_unconfirmed_allowed" if ctx.allow_unconfirmed_free else "strict_free"))
        elif ctx.budget != "any":
            ctx.applied.append(Notice(code="budget_soft", params={"budget": ctx.budget}))

        # ---- time, pace, distance
        ctx.transport = transport or intent.transport or "walk"
        pace = prof.pace if prof else "normal"
        ctx.speed_m_per_min = PACE_SPEED_M_PER_MIN[pace] if ctx.transport == "walk" else SPEED_M_PER_MIN[ctx.transport]
        if prof and pace != "normal":
            ctx.applied.append(Notice(code="pace", params={"pace": pace}))
        ctx.time_minutes = req_time or (sess.time_minutes if sess else None) or intent.time_minutes or (prof.walk_duration_min if prof else None)
        if ctx.time_minutes:
            ctx.applied.append(Notice(code="time_budget", params={"minutes": ctx.time_minutes}))
        radii = [r for r in (req_radius, intent.max_distance_m, radius_for_time(ctx.time_minutes, ctx.speed_m_per_min) if ctx.time_minutes else None) if r]
        if prof and prof.max_walk_m and ctx.transport == "walk":
            radii.append(prof.max_walk_m)
            ctx.applied.append(Notice(code="max_walk", params={"meters": prof.max_walk_m}))
        ctx.radius_m = max(100, min(min(radii) if radii else 2000, 20000))

        # ---- interests with their source (request > session > mood > profile)
        def add(interest: str, weight: float, source: str) -> None:
            w = weight * SOURCE_WEIGHT[source]
            if interest not in ctx.interests or ctx.interests[interest][0] < w:
                ctx.interests[interest] = (w, source)

        for i in intent.interests:
            add(i, 1.0, "request")
        for i in [*(req_interests or []), *((sess.interests) if sess else [])]:
            add(i, 1.0, "session")
        if sess and sess.mood:
            ctx.mood = sess.mood
            for i, w in MOOD_INTERESTS[sess.mood].items():
                add(i, w, "mood")
        for i in (prof.interests if prof else []):
            add(i, 1.0, "profile")
        # an atmosphere stated in the text is a request-level interest (a ranking preference, not a fact about places)
        if intent.atmosphere in ATMOSPHERE_INTEREST:
            add(ATMOSPHERE_INTEREST[intent.atmosphere], 1.0, "request")
        # a soft interest whose main category the user excluded today does not count as a match
        for i in [i for i, (_, src) in ctx.interests.items() if src != "request"]:
            aff = AFFINITY.get(i, {})
            if aff and max(aff, key=aff.get) in ctx.exclude_categories:
                del ctx.interests[i]
        ctx.company = sess.company if sess else None
        ctx.kids = bool(req_children or intent.with_children or ctx.company == "family" or (prof and prof.with_children))
        if ctx.kids:
            add("family", 1.0, "request" if (req_children or intent.with_children) else "session" if ctx.company == "family" else "profile")
        ctx.profile_vector = _interest_vector(self.emb, {i: w for i, (w, _) in ctx.interests.items()})

        ctx.favorite_categories = set(prof.favorite_categories) if prof else set()
        ctx.setting = prof.setting if prof else "any"
        ctx.places_count = prof.places_count if prof else 3
        if use_profile and p.feedback:
            ctx.feedback = build_feedback(db, p.feedback)
        return ctx
