"""SurpriseRecommendationService ("Удиви меня", stage 6).

Not a random POI. One real place that is relevant to the current walk context AND new for this user:

1. Context — the same RecommendationContext as the map (mood, interests, time, budget, start point, weather,
   accessibility, exclusions) through the shared helpers and PersonalizationService.
2. Candidates — the existing personal retrieval (`retrieve`): hard filters (radius from the time budget, never-again,
   wheelchair, strict free, excluded categories) and the personal ranking. Places already offered in this session,
   visited, liked or saved are excluded: they would not surprise.
3. Novelty — computed only from the user's own history and the categories, never from "popularity" (we have no such
   data, so a place is never called little-known): a category the user has not favoured, liked or been shown in this
   session counts as new; categories that are usually "unusual" (attraction, architecture, gallery) get a small bonus.
4. Score = 0.55 × relevance (personal ranking, normalised in the pool) + 0.35 × novelty + 0.10 × unusual-category.
   One of the 5 best is drawn at random with weights ∝ score, so "another option" gives a different, still relevant place.
5. Explanation from facts: why (mood / interests / new category / weather / distance), distance and time estimates,
   "what to do" — an LLM idea validated like every AI text when Gemini is configured, otherwise a category-level idea
   that is labelled as such. Nothing about the place is invented.
"""
import asyncio
import json
import random
from dataclasses import dataclass

from sqlalchemy import select

from app.models import Poi
from app.rag.retrieval import Candidate, retrieve, travel_minutes
from app.rag.taxonomy import AFFINITY, VISIT_MINUTES
from app.schemas.ai import Notice, Recommendation, UsedLocation
from app.schemas.context import RecommendationContext
from app.schemas.weather import WeatherAssessment
from app.services.context import assess_weather, build_context, resolve_start
from app.services.llm import LLMService, LLMUnavailable
from app.services.personalization import PersonalContext, PersonalizationService
from app.services.query_understanding import LANG_NAME
from app.services.recommendation import RecommendationService, _card, _facts

POOL = 30
TOP = 5
UNUSUAL_CATEGORIES = {c for c, w in AFFINITY["unusual"].items() if w >= 0.8}


@dataclass
class SurprisePick:
    card: Recommendation
    reasons: list[str]  # codes rendered by the UI
    novelty: float
    relevance: float
    idea_source: str  # "ai" | "category" | "none"
    travel_minutes: int | None
    visit_minutes: int
    pool_size: int


def novelty_of(c: Candidate, known_categories: set[str], shown_categories: set[str]) -> float:
    """1.0 for a category new to this user, lower for categories they already favour or saw in this session."""
    cat = c.poi.category
    if cat in shown_categories:
        return 0.2
    if cat in known_categories:
        return 0.4
    return 1.0


def pick_surprise(cands: list[Candidate], known: set[str], shown: set[str], rnd: random.Random) -> tuple[Candidate, float, float] | None:
    """Weighted draw among the TOP best by 0.55·relevance + 0.35·novelty + 0.10·unusual-category."""
    if not cands:
        return None
    lo, hi = min(c.final for c in cands), max(c.final for c in cands)
    rng = (hi - lo) or 1.0
    scored = []
    for c in cands:
        rel = (c.final - lo) / rng if hi > lo else 1.0
        nov = novelty_of(c, known, shown)
        unusual = 1.0 if c.poi.category in UNUSUAL_CATEGORIES else 0.0
        scored.append((0.55 * rel + 0.35 * nov + 0.10 * unusual, rel, nov, c))
    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:TOP]
    total, rel, nov, chosen = rnd.choices(top, weights=[max(0.01, s[0]) for s in top], k=1)[0]
    return chosen, rel, nov


def reasons_for(c: Candidate, nov: float, ctx: PersonalContext) -> list[str]:
    out: list[str] = []
    sources = {s for _, s in c.matched}
    if "mood" in sources and ctx.mood:
        out.append("mood")
    if "profile" in sources or "session" in sources or "request" in sources:
        out.append("interests")
    if nov >= 1.0:
        out.append("new_category")
    if c.poi.category in UNUSUAL_CATEGORIES:
        out.append("unusual_category")
    if c.weather_fit:
        out.append(c.weather_fit)
    if c.distance_m is not None and c.distance_m <= 800:
        out.append("close")
    out.append("not_shown_before")
    return out


class SurpriseRecommendationService:
    def __init__(self, recommender: RecommendationService, weather) -> None:
        self.rec = recommender
        self.llm: LLMService = recommender.llm
        self.emb = recommender.emb
        self.session_factory = recommender.session_factory
        self.weather = weather
        self.personal = PersonalizationService(self.emb)

    def _retrieve(self, rc: RecommendationContext, anchor, weather: WeatherAssessment | None):
        with self.session_factory() as db:
            # no point, radius or time: look in a wider circle around the centre instead of the default 2 km
            wide = {} if (rc.location or rc.radius_m or rc.time_minutes) else {"req_radius": 6000}
            ctx = build_context(self.personal, db, rc, weather, **wide)
            fb = rc.personalization.feedback if rc.personalization and rc.personalization.feedback else None
            if fb:  # places the user already knows would not surprise them
                ctx.exclude_ids |= set(fb.visited) | set(fb.liked) | set(fb.saved) | set(fb.more_like)
            cands, considered = retrieve(db, self.emb, ctx, query_text=None, anchor=anchor, limit=POOL)
            shown_ids = set(rc.exclude_poi_ids)
            shown = set(db.scalars(select(Poi.category).where(Poi.id.in_(shown_ids))).all()) if shown_ids else set()
            known = set(ctx.favorite_categories)
            if ctx.feedback:
                known |= {cat for cat, a in ctx.feedback.category_affinity.items() if a > 0}
            return ctx, cands, considered, known, shown

    async def _idea(self, c: Candidate, ctx: PersonalContext, lang: str) -> tuple[str | None, str | None]:
        """(reason, activity idea) from the LLM, validated against this place's facts; (None, None) without AI."""
        if not self.llm.configured:
            return None, None
        lines = [
            f"ANSWER_LANGUAGE: {LANG_NAME[lang]}",
            "MAX_PICKS: 1",
            "USER_REQUEST: " + json.dumps("Surprise me: suggest one place I would not think of myself, explain why it may interest me.", ensure_ascii=False),
        ]
        if ctx.mood:
            lines.append("USER_PROFILE: " + json.dumps({"mood": ctx.mood}, ensure_ascii=False))
        lines.append("CANDIDATES: " + json.dumps([_facts(c, lang)], ensure_ascii=False))
        try:
            out, picks, _ = await self.rec._generate_validated("\n".join(lines), {c.poi.id: c}, lang)
        except LLMUnavailable:
            return None, None
        if out is None or not picks:
            return None, None
        return picks[0].reason or None, picks[0].activity_idea or None

    async def surprise(self, rc: RecommendationContext, seed: int | None = None) -> tuple[SurprisePick | None, UsedLocation, list[Notice], WeatherAssessment | None]:
        anchor, used, notices = resolve_start(rc)
        weather, wnotes = await assess_weather(self.weather, rc.use_weather, anchor, rc.time_minutes or 90)
        notices += [n for n in wnotes if n.code != "weather_off"]
        ctx, cands, considered, known, shown = await asyncio.to_thread(self._retrieve, rc, anchor, weather)
        chosen = pick_surprise(cands, known, shown, random.Random(seed))
        if chosen is None:
            notices.append(Notice(code="surprise_none", params={"radius_m": ctx.radius_m}))
            return None, used, notices, weather
        c, rel, nov = chosen
        card = _card(c, rc.lang, ctx)
        reason, idea = await self._idea(c, ctx, rc.lang)
        card.reason, card.activity_idea = reason, idea
        travel = travel_minutes(c.distance_m, ctx.speed_m_per_min) if c.distance_m is not None else None
        pick = SurprisePick(
            card=card, reasons=reasons_for(c, nov, ctx), novelty=round(nov, 2), relevance=round(rel, 2),
            idea_source="ai" if idea else "category", travel_minutes=travel, visit_minutes=VISIT_MINUTES.get(c.poi.category, 20),
            pool_size=len(cands),
        )
        return pick, used, notices, weather
