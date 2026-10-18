"""QuestGenerationService (AI Quest, stage 6): turns a real walk into a small adventure.

1. Quest type → interests (session level) on top of the shared walk context (mood, profile, time, budget, weather,
   accessibility). Candidates come from the existing personal retrieval (`retrieve`) — real POIs only.
2. The existing RoutePlanningService chooses 2–3 stops and their order within the time budget (real pedestrian route
   when Valhalla is up, labelled straight-line estimates otherwise). A quest never needs more stops than fit in time.
3. Tasks (2–5) are built from templates bound to POI ids and to facts present in the record (OSM tags such as
   historic=*, artwork_type, cuisine). A template never states a fact: it asks the user to look, photograph, compare
   or rest, and "read the information on site, if there is any". Places with unknown hours are flagged.
4. Optional: Gemini rewrites the quest title and task wording; every text is checked with the same validator as AI
   recommendations (no invented times, prices, ratings, "open now") and must keep the same POI ids; otherwise the
   templates are used. Generation never depends on Gemini.
5. Progress (pending → active → completed / skipped) is held by the client, like the walk session: the user confirms
   each task — nothing is detected automatically.
"""
import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

from pydantic import BaseModel, Field

from app.rag.retrieval import Candidate, retrieve
from app.schemas.ai import Notice
from app.schemas.context import Quest, QuestRequest, QuestTask
from app.schemas.routes import Route, RouteExplanation, StartPoint
from app.schemas.weather import WeatherAssessment
from app.services.context import assess_weather, build_context, resolve_start
from app.services.llm import LLMInvalidOutput, LLMService, LLMUnavailable
from app.services.personalization import PersonalizationService
from app.services.query_understanding import LANG_NAME
from app.services.recommendation import _violations
from app.services.route_planning import PACE_KMH, RoutePlanningService

log = logging.getLogger("quest")
POOL = 9

# quest type -> interests used for retrieval (a ranking preference, like a mood)
QUEST_INTERESTS: dict[str, dict[str, float]] = {
    "explorer": {"beautiful": 1.0, "unusual": 0.8, "parks": 0.6, "culture": 0.6},
    "photo_hunt": {"photo": 1.0, "beautiful": 0.9, "architecture": 0.8},
    "architecture": {"architecture": 1.0, "history": 0.6, "beautiful": 0.5},
    "history": {"history": 1.0, "museums": 0.9, "culture": 0.6},
    "family": {"family": 1.0, "kids": 0.9, "parks": 0.7},
    "city_secrets": {"unusual": 1.0, "art": 0.8, "beautiful": 0.4},
}
QUEST_TYPES = tuple(QUEST_INTERESTS)
PUBLIC_SPACES = {"park", "public_space", "promenade", "viewpoint", "playground"}
FACT_TAGS = ("historic", "memorial", "artwork_type", "artist_name", "architect", "start_date", "heritage", "cuisine", "sport")

# (quest type, category) -> template code; "*" = any category. First match wins.
TEMPLATES: list[tuple[str, set[str] | None, str]] = [
    ("photo_hunt", {"architecture", "monument", "attraction", "public_space", "promenade", "viewpoint"}, "photo_angle"),
    ("photo_hunt", None, "photo_detail"),
    ("architecture", {"architecture", "monument", "attraction", "theatre", "museum", "gallery", "library", "mall"}, "facade_detail"),
    ("history", {"monument", "architecture"}, "read_on_site"),
    ("history", {"museum", "gallery"}, "museum_pick"),
    ("family", {"playground", "park"}, "family_play"),
    ("family", {"cafe", "restaurant"}, "rest_stop"),
    ("city_secrets", None, "three_unnoticed"),
    ("*", {"museum", "gallery"}, "museum_pick"),
    ("*", {"monument"}, "read_on_site"),
    ("*", {"park", "promenade", "public_space"}, "three_unnoticed"),
    ("*", {"cafe", "restaurant"}, "rest_stop"),
    ("*", None, "visit_look"),
]


class LLMQuestTask(BaseModel):
    task_id: str
    text: str = Field(max_length=300)


class LLMQuest(BaseModel):
    title: str = Field(max_length=80)
    tasks: list[LLMQuestTask] = Field(default_factory=list, max_length=5)


QUEST_SYSTEM = """You write short, friendly quest texts for a walking game in Astana.
You get a QUEST with tasks that are ALREADY chosen and bound to real places. For each task_id write one sentence (max 25 words)
in ANSWER_LANGUAGE that asks the user to do the given ACTION at the given place.
Rules: use only the place names and FACTS given; never invent history, dates, exhibits, events, prices, opening hours,
numbers or features of a place; never claim a place is open, quiet or safe; never send the user into closed, private or
dangerous areas; do not translate place names. Also write a quest title (max 6 words). Return only the given task_ids."""


def template_for(quest_type: str, category: str) -> str:
    for qt, cats, code in TEMPLATES:
        if qt in (quest_type, "*") and (cats is None or category in cats):
            return code
    return "visit_look"


def kind_of(code: str) -> str:
    return {"photo_angle": "photo", "photo_detail": "photo", "facade_detail": "observe", "read_on_site": "observe",
            "museum_pick": "observe", "three_unnoticed": "observe", "family_play": "visit", "rest_stop": "rest"}.get(code, "visit")


def facts_of(c: Candidate) -> list[str]:
    tags = c.poi.tags or {}
    return [f"{k}={str(tags[k])[:60]}" for k in FACT_TAGS if tags.get(k)]


def build_tasks(quest_type: str, stops: list[Candidate], count: int, lang: str) -> list[QuestTask]:
    """One task per stop (bound to its POI id) + cross-stop tasks until `count` (2–5) is reached."""
    def name(c: Candidate) -> str:
        return (c.poi.name_kk if lang == "kk" else c.poi.name_ru) or c.poi.name or ""

    tasks: list[QuestTask] = []
    for c in stops:
        code = template_for(quest_type, c.poi.category)
        tasks.append(QuestTask(
            id=f"t{len(tasks) + 1}", poi_ids=[c.poi.id], kind=kind_of(code), template=code,
            params={"place": name(c), "category": c.poi.category}, facts=facts_of(c), hours_unknown=not c.poi.opening_hours,
        ))
    extras: list[QuestTask] = []
    if len(stops) >= 2:
        a, b = stops[0], stops[1]
        public = [c for c in stops if c.poi.category in PUBLIC_SPACES]
        if len(public) >= 2 and public[0].poi.category != public[1].poi.category:
            extras.append(QuestTask(id="", poi_ids=[public[0].poi.id, public[1].poi.id], kind="compare", template="two_public_spaces",
                                    params={"a": name(public[0]), "b": name(public[1])}))
        extras.append(QuestTask(id="", poi_ids=[a.poi.id, b.poi.id], kind="compare", template="compare_two", params={"a": name(a), "b": name(b)}))
        if quest_type == "photo_hunt":
            extras.append(QuestTask(id="", poi_ids=[c.poi.id for c in stops], kind="photo", template="photo_series", params={"n": len(stops)}))
        if len(stops) >= 3:
            extras.append(QuestTask(id="", poi_ids=[c.poi.id for c in stops], kind="observe", template="favourite_stop", params={"n": len(stops)}))
    # few stops fit the time: a second, different task at each stop (at most one more per stop)
    for c in stops:
        primary = template_for(quest_type, c.poi.category)
        # a photo task gets an observation task next to it, anything else gets a photo task
        second = "three_unnoticed" if primary.startswith("photo") else "photo_detail"
        extras.append(QuestTask(id="", poi_ids=[c.poi.id], kind=kind_of(second), template=second,
                                params={"place": name(c), "category": c.poi.category}, hours_unknown=not c.poi.opening_hours))
    for t in extras:
        if len(tasks) >= count:
            break
        t.id = f"t{len(tasks) + 1}"
        tasks.append(t)
    return tasks[:max(2, min(5, count))]


class QuestGenerationService:
    def __init__(self, emb, llm: LLMService, weather, planner: RoutePlanningService, session_factory) -> None:
        self.emb, self.llm, self.weather, self.planner, self.session_factory = emb, llm, weather, planner, session_factory
        self.personal = PersonalizationService(emb)

    def _candidates(self, req: QuestRequest, anchor, time_min: int, weather: WeatherAssessment | None):
        with self.session_factory() as db:
            ctx = build_context(self.personal, db, req, weather, req_interests=[i for i, _ in sorted(QUEST_INTERESTS[req.quest_type].items(), key=lambda x: -x[1])])
            ctx.full_visit_fit = True
            # a quest may use half of its time to reach its farthest stop (as Living Route)
            reach = int(ctx.speed_m_per_min * time_min * 0.5 / 1.3)
            ctx.radius_m = min(max(ctx.radius_m, reach), req.radius_m or 20000)
            if req.quest_type == "family":
                ctx.kids = True
            cands, _ = retrieve(db, self.emb, ctx, query_text=None, anchor=anchor, limit=POOL)
            return ctx, cands

    async def _ai_texts(self, quest: Quest, by_id: dict[int, Candidate], lang: str) -> None:
        """Optional AI wording; silently keeps the templates when Gemini is absent or its text fails validation."""
        if not self.llm.configured:
            return
        facts = {pid: {"name": (c.poi.name_kk if lang == "kk" else c.poi.name_ru) or c.poi.name, "category": c.poi.category, "facts": facts_of(c)}
                 for pid, c in by_id.items()}
        payload = {"type": quest.type, "tasks": [{"task_id": t.id, "action": t.template, "places": [facts[p] for p in t.poi_ids if p in facts]} for t in quest.tasks]}
        try:
            out = await self.llm.generate(system=QUEST_SYSTEM, prompt=f"ANSWER_LANGUAGE: {LANG_NAME[lang]}\nQUEST: {json.dumps(payload, ensure_ascii=False)}",
                                          schema=LLMQuest, max_output_tokens=700, temperature=0.5)
        except (LLMUnavailable, LLMInvalidOutput):
            return
        allowed = json.dumps(payload, ensure_ascii=False).lower()
        texts = {t.task_id: t.text for t in out.tasks}
        used = False
        for t in quest.tasks:
            txt = texts.get(t.id)
            if txt and not _violations(txt, allowed):
                t.text, used = txt.strip(), True
        if out.title and not _violations(out.title, ""):
            quest.title, used = out.title.strip(), True
        if used:
            quest.generated_by = "ai"

    async def generate(self, req: QuestRequest) -> Quest:
        anchor, used, notices = resolve_start(req)
        time_min = req.time_minutes or 90
        if not req.time_minutes:
            notices.append(Notice(code="quest_default_time", params={"minutes": time_min}))
        weather, wnotes = await assess_weather(self.weather, req.use_weather, anchor, time_min)
        notices += [n for n in wnotes if n.code != "weather_off"]
        ctx, cands = await asyncio.to_thread(self._candidates, req, anchor, time_min, weather)
        start = StartPoint(latitude=anchor[0], longitude=anchor[1], source="manual" if req.location else "default_city_center")
        pace = req.personalization.profile.pace if (req.personalization and req.personalization.use_profile and req.personalization.profile) else "normal"
        places = min(3, max(2, req.tasks_count - 1)) if req.tasks_count >= 3 else 2
        outcome = await self.planner.plan(start=start, candidates=cands, lang=req.lang, places_count=places, pace=pace, time_budget=time_min,
                                          max_walk_m=None, weather=weather, wheelchair=ctx.wheelchair)
        route = Route(
            status=outcome.status, routing_engine="valhalla-pedestrian" if outcome.status == "ok" else None, pace=pace,
            walking_speed_kmh=PACE_KMH[pace], start=start, stops=outcome.stops, legs=outcome.legs, totals=outcome.totals,
            explanation=RouteExplanation(order=outcome.order_reason, preferences=ctx.info().interests, constraints=ctx.applied, weather=weather,
                                         weather_effect=outcome.weather_effect, selection=outcome.selection, missing_data=[],
                                         alternatives_considered=outcome.considered),
            notices=outcome.notices, computed_at=datetime.now(timezone.utc),
        )
        by_id = {c.poi.id: c for c in cands}
        stops = [by_id[s.poi_id] for s in outcome.stops if s.poi_id in by_id]
        tasks = build_tasks(req.quest_type, stops, req.tasks_count, req.lang) if stops else []
        if stops and len(tasks) < req.tasks_count:
            notices.append(Notice(code="quest_fewer_tasks", params={"requested": req.tasks_count, "made": len(tasks)}))
        quest = Quest(id=uuid.uuid4().hex[:16], type=req.quest_type, title=None, stops=[c.poi.id for c in stops], tasks=tasks,
                      estimated_minutes=route.totals.total_minutes if route.totals else None, route=route, generated_by="template",
                      notices=notices, used_location=used)
        if not stops:
            quest.notices.append(Notice(code="quest_no_places", params={"minutes": time_min}))
            return quest
        await self._ai_texts(quest, {c.poi.id: c for c in stops}, req.lang)
        return quest
