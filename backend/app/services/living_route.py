"""LivingRouteService: plan a walk and re-plan it while the user walks.

The walk state (RouteSession) is held by the client and sent with every request; the server is stateless.
Pipeline for both plan and replan:
  conditions (request > walk session > profile) → PersonalContext → weather (optional, cached)
  → retrieval of candidates near the CURRENT position (+ stops still pending) → RoutePlanningService
  → diff with the previous route (replan) → optional LLM summary of the computed facts only.
"""
import asyncio
import json
import logging
import re
from datetime import datetime, timezone

from pydantic import BaseModel, Field

from app.models import Poi
from app.rag.embeddings import EmbeddingService
from app.rag.retrieval import CITY_CENTER, retrieve
from app.schemas.ai import Notice, QueryIntent
from app.schemas.personalization import PersonalizationInput, SessionPreferences
from app.schemas.routes import (
    ChangedStop, PlanRequest, ReplanRequest, ReplanResponse, Route, RouteChange, RouteExplanation, SessionPrefs,
    SessionUpdate, StartPoint,
)
from app.rag.taxonomy import INDOOR_CATEGORIES
from app.schemas.weather import WeatherAssessment
from app.services.llm import LLMInvalidOutput, LLMService, LLMUnavailable
from app.services.personalization import PersonalContext, PersonalizationService
from app.services.query_understanding import LANG_NAME, understand
from app.services.route_planning import PACE_KMH, RoutePlanningService
from app.services.context import assess_weather
from app.services.weather import WeatherService

log = logging.getLogger("living_route")
POOL = 8
LESS_WALKING_MAX_M = 1200
INDOOR_CAP_MIN = 10


class LLMRouteSummary(BaseModel):
    summary: str = Field(max_length=500)


SUMMARY_SYSTEM = """You explain a walking route in Astana that was ALREADY computed by a routing algorithm.
Use only the facts in ROUTE_FACTS (stop names, categories, minutes, metres, weather conditions, changes and their reason codes).
Never add places, times, distances, prices, opening hours or claims about shelter from wind that are not in the facts.
Visit durations are estimates — say "about". Write 1–3 short sentences in ANSWER_LANGUAGE. If CHANGES are present,
say what was removed/added and why using the given reason codes, nothing else."""

_NUM = re.compile(r"\d+(?:[.,]\d+)?")


class LivingRouteService:
    def __init__(self, emb: EmbeddingService, llm: LLMService, weather: WeatherService, planner: RoutePlanningService, session_factory) -> None:
        self.emb, self.llm, self.weather, self.planner, self.session_factory = emb, llm, weather, planner, session_factory
        self.personal = PersonalizationService(emb)

    # ------------------------------------------------------------------ shared

    def _context_and_candidates(self, p: PersonalizationInput | None, intent: QueryIntent | None, sprefs: SessionPrefs,
                                anchor: tuple[float, float], time_min: int | None, query: str | None,
                                categories: list[str] | None, exclude_ids: set[int], keep_ids: set[int],
                                explicit_ids: list[int] | None, weather: WeatherAssessment | None):
        with self.session_factory() as db:
            pin = (p or PersonalizationInput()).model_copy(deep=True)
            sess = pin.session or SessionPreferences()
            if sprefs.mood:
                sess.mood = sprefs.mood
            sess.interests = list(dict.fromkeys([*sess.interests, *sprefs.interests]))[:8]
            sess.exclude_categories = list(dict.fromkeys([*sess.exclude_categories, *sprefs.exclude_categories]))[:16]
            pin.session = sess
            ctx: PersonalContext = self.personal.build(db, p=pin, intent=intent, req_time=time_min, req_categories=categories)
            ctx.weather = weather
            ctx.full_visit_fit = True
            if time_min:  # a route may use up to half of the time to reach its farthest stop
                reach = int(ctx.speed_m_per_min * time_min * 0.5 / 1.3)
                limit = pin.profile.max_walk_m if (pin.use_profile and pin.profile and pin.profile.max_walk_m) else 20000
                ctx.radius_m = min(max(ctx.radius_m, reach), limit)
            ctx.exclude_ids |= exclude_ids
            if sprefs.indoor:
                ctx.setting = "indoor"
            if explicit_ids:
                cands, _ = retrieve(db, self.emb, ctx, query_text=query, anchor=anchor, limit=3, only_ids=set(explicit_ids), explicit=True)
                order = {pid: i for i, pid in enumerate(explicit_ids)}
                cands.sort(key=lambda c: order.get(c.poi.id, 99))
                return ctx, cands
            cands, _ = retrieve(db, self.emb, ctx, query_text=query, anchor=anchor, limit=POOL)
            if keep_ids:  # stops still pending stay candidates if they still pass all hard filters
                kept, _ = retrieve(db, self.emb, ctx, query_text=query, anchor=anchor, limit=3, only_ids=keep_ids)
                kept_ids = {k.poi.id for k in kept}
                cands = [*kept, *[c for c in cands if c.poi.id not in kept_ids]][:POOL + 1]
            return ctx, cands

    async def _weather(self, use: bool, at: tuple[float, float], minutes: int) -> tuple[WeatherAssessment | None, list[Notice]]:
        return await assess_weather(self.weather, use, at, minutes)

    def _pace(self, p: PersonalizationInput | None, sprefs: SessionPrefs) -> str:
        if sprefs.less_walking:
            return "slow"
        if p and p.use_profile and p.profile:
            return p.profile.pace
        return "normal"

    async def _summary(self, lang: str, route: Route, change: RouteChange | None) -> str | None:
        """Optional natural-language summary; every number in it must appear in the facts."""
        if not self.llm.configured or not route.stops:
            return None
        facts = {
            "stops": [{"name": s.name, "category": s.category, "visit_minutes_estimate": s.visit_minutes, "arrive_after_min": s.arrive_after_min} for s in route.stops],
            "totals": route.totals.model_dump() if route.totals else None,
            "routing": route.status,
            "weather_conditions": route.explanation.weather.conditions if route.explanation.weather else None,
            "order": route.explanation.order,
        }
        if change:
            facts["changes"] = {"removed": [r.model_dump() for r in change.removed], "added": [a.model_dump() for a in change.added],
                                "kept": [k.name for k in change.kept], "before_total_minutes": change.before_total_minutes,
                                "after_total_minutes": change.after_total_minutes, "condition_changes": [n.code for n in change.reasons]}
        blob = json.dumps(facts, ensure_ascii=False, default=str)
        try:
            out = await self.llm.generate(system=SUMMARY_SYSTEM, prompt=f"ANSWER_LANGUAGE: {LANG_NAME[lang]}\nROUTE_FACTS: {blob}",
                                          schema=LLMRouteSummary, max_output_tokens=400, temperature=0.2)
        except (LLMUnavailable, LLMInvalidOutput):
            return None
        allowed = set(_NUM.findall(blob))
        if any(n not in allowed for n in _NUM.findall(out.summary)):
            log.info("route summary dropped: contains numbers that are not in the facts")
            return None
        return out.summary

    def _route(self, outcome, start: StartPoint, pace: str, ctx: PersonalContext, weather, weather_notes: list[Notice], extra_notes: list[Notice]) -> Route:
        return Route(
            status=outcome.status,
            routing_engine="valhalla-pedestrian" if outcome.status == "ok" else None,
            pace=pace, walking_speed_kmh=PACE_KMH[pace], start=start, stops=outcome.stops, legs=outcome.legs, totals=outcome.totals,
            explanation=RouteExplanation(
                order=outcome.order_reason, preferences=ctx.info().interests, constraints=ctx.applied, weather=weather,
                weather_effect=outcome.weather_effect, selection=outcome.selection,
                missing_data=[n for n in outcome.notices if n.code == "hours_unknown"], alternatives_considered=outcome.considered,
            ),
            notices=[*extra_notes, *weather_notes, *[n for n in outcome.notices if n.code != "hours_unknown"]],
            computed_at=datetime.now(timezone.utc),
        )

    # -------------------------------------------------------------------- plan

    async def plan(self, req: PlanRequest) -> Route:
        start = req.start
        anchor = (start.latitude, start.longitude)
        p = req.personalization
        prof = p.profile if (p and p.use_profile) else None
        notes: list[Notice] = []
        time_budget = req.time_minutes or (prof.walk_duration_min if prof else None)
        if not time_budget:
            time_budget = 60
            notes.append(Notice(code="route_default_time", params={"minutes": 60}))
        sprefs = SessionPrefs()
        weather, wnotes = await self._weather(req.use_weather, anchor, time_budget)
        ctx, cands = await asyncio.to_thread(
            self._context_and_candidates, p, None, sprefs, anchor, time_budget, req.query, req.categories,
            set(), set(), req.poi_ids, weather,
        )
        if req.poi_ids and len(cands) < len(req.poi_ids):
            notes.append(Notice(code="route_poi_missing", params={"count": len(req.poi_ids) - len(cands)}))
        pace = self._pace(p, sprefs)
        places = len(req.poi_ids) if req.poi_ids else (req.places_count or ctx.places_count)
        outcome = await self.planner.plan(
            start=start, candidates=cands, lang=req.lang, places_count=places, pace=pace, time_budget=time_budget,
            max_walk_m=prof.max_walk_m if prof else None, weather=weather, wheelchair=ctx.wheelchair,
            must_ids=set(req.poi_ids or []) if req.poi_ids and len(req.poi_ids) == 1 else set(),
        )
        route = self._route(outcome, start, pace, ctx, weather, wnotes, notes)
        route.message = await self._summary(req.lang, route, None)
        return route

    # ------------------------------------------------------------------ replan

    async def replan(self, req: ReplanRequest) -> ReplanResponse:
        s, ev = req.session, req.event
        visited, skipped, rejected = list(s.visited), list(s.skipped), list(s.rejected)
        prefs = s.prefs.model_copy(deep=True)
        current = s.current
        remaining = s.remaining_min if s.remaining_min is not None else s.time_budget_min
        reasons: list[Notice] = []
        must: set[int] = set()
        intent: QueryIntent | None = None
        finished = False

        # ---- 1. apply the event to the walk state
        if ev.type == "time_left" and ev.minutes is not None:
            remaining = ev.minutes
            reasons.append(Notice(code="time_changed", params={"minutes": ev.minutes}))
        elif ev.type in ("less_walking", "tired"):
            prefs.less_walking = True
            if ev.type == "tired":
                prefs.interests = list(dict.fromkeys([*prefs.interests, "relax"]))
            reasons.append(Notice(code=ev.type))
        elif ev.type == "go_indoor":
            prefs.indoor = True
            reasons.append(Notice(code="go_indoor"))
        elif ev.type in ("visited", "skip", "reject") and ev.poi_id:
            {"visited": visited, "skip": skipped, "reject": rejected}[ev.type].append(ev.poi_id)
            reasons.append(Notice(code=f"poi_{ev.type}", params={"poi_id": ev.poi_id}))
            if ev.type == "visited" and not ev.location:
                poi = await asyncio.to_thread(self._poi, ev.poi_id)
                if poi:  # we assume the user is at the place they just visited — and say so
                    current = StartPoint(latitude=poi.latitude, longitude=poi.longitude, source="last_visited", label=poi.name)
        elif ev.type == "add_poi" and ev.poi_id:
            must.add(ev.poi_id)
            reasons.append(Notice(code="poi_added", params={"poi_id": ev.poi_id}))
        elif ev.type == "interests" and ev.interests is not None:
            prefs.interests = list(ev.interests)
            reasons.append(Notice(code="interests_changed"))
        elif ev.type == "mood":
            prefs.mood = ev.mood
            reasons.append(Notice(code="mood_changed"))
        elif ev.type == "weather_refresh":
            reasons.append(Notice(code="weather_refresh"))
        elif ev.type == "manual":
            reasons.append(Notice(code="manual"))
        elif ev.type == "message" and ev.message:
            intent = await understand(self.llm, message=ev.message, ui_lang=req.lang, previous=None, history=[])
            if intent.time_minutes:
                remaining = intent.time_minutes
                reasons.append(Notice(code="time_changed", params={"minutes": intent.time_minutes}))
            if intent.less_walking:
                prefs.less_walking = True
                reasons.append(Notice(code="less_walking"))
            if intent.go_indoor:
                prefs.indoor = True
                reasons.append(Notice(code="go_indoor"))
            if intent.exclude_categories:
                prefs.exclude_categories = list(dict.fromkeys([*prefs.exclude_categories, *intent.exclude_categories]))
                reasons.append(Notice(code="categories_excluded", params={"categories": ",".join(intent.exclude_categories)}))
            if intent.interests:
                prefs.interests = list(dict.fromkeys([*prefs.interests, *intent.interests]))[:8]
                reasons.append(Notice(code="interests_changed"))
            if intent.finish_now:
                finished = True
                reasons.append(Notice(code="finish"))
        if ev.location:
            current = ev.location
            reasons.append(Notice(code="location_updated", params={"source": ev.location.source}))

        # ---- 2. where do we (re)start from?
        notes: list[Notice] = []
        if current is None:
            last = next(iter(reversed(visited)), None)
            poi = await asyncio.to_thread(self._poi, last) if last else None
            if poi:
                current = StartPoint(latitude=poi.latitude, longitude=poi.longitude, source="last_visited", label=poi.name)
            else:
                current = StartPoint(**s.start.model_dump())
                if s.start.source != "default_city_center":
                    current.source = "route_start"
        if current.source in ("last_visited", "route_start", "default_city_center"):
            notes.append(Notice(code="start_assumed", params={"source": current.source}))

        pending = [i for i in s.stops if i not in set(visited) | set(skipped) | set(rejected)]
        excluded_ids = set(visited) | set(skipped) | set(rejected)
        update = SessionUpdate(version=s.version + 1, current=current, stops=pending, visited=visited, skipped=skipped,
                               rejected=rejected, remaining_min=remaining, prefs=prefs, finished=finished)
        before = RouteChange(kept=[], removed=[], added=[], before_total_minutes=s.last_total_minutes, after_total_minutes=None,
                             before_distance_m=s.last_distance_m, after_distance_m=None, reasons=reasons)

        if finished or (remaining is not None and remaining < 10):
            if not finished:
                notes.append(Notice(code="route_time_too_short", params={"budget": remaining or 0, "needed": 10}))
            route = Route(status="no_feasible", routing_engine=None, pace=self._pace(req.personalization, prefs),
                          walking_speed_kmh=PACE_KMH[self._pace(req.personalization, prefs)], start=current, stops=[], legs=[], totals=None,
                          explanation=RouteExplanation(order="single_stop", preferences=[], constraints=[], weather=None, weather_effect=[],
                                                       selection=[], missing_data=[], alternatives_considered=0),
                          notices=notes, computed_at=datetime.now(timezone.utc))
            names = await asyncio.to_thread(self._names, pending, req.lang)
            before.removed = [ChangedStop(poi_id=i, name=names.get(i), reason="finished" if finished else "time") for i in pending]
            update.stops = []
            return ReplanResponse(route=route, change=before, session=update)

        # ---- 3. conditions → candidates near the current position → plan
        anchor = (current.latitude, current.longitude)
        weather, wnotes = await self._weather(req.use_weather, anchor, remaining or 60)
        if prefs.indoor and weather is not None:
            weather = weather.model_copy(update={"level": "indoor_preferred", "outdoor_cap_min": min(weather.outdoor_cap_min or INDOOR_CAP_MIN, INDOOR_CAP_MIN)})
        elif prefs.indoor:
            weather = WeatherAssessment(level="indoor_preferred", conditions=["comfortable"], outdoor_cap_min=INDOOR_CAP_MIN, basis="current",
                                        window_minutes=remaining or 60, max_wind_ms=None, max_gusts_ms=None, min_apparent_c=None,
                                        max_precipitation_probability_pct=None)
        if intent and intent.include_categories:  # "хочу кофе": one stop of that kind is required
            ctx_cat, cat_cands = await asyncio.to_thread(
                self._context_and_candidates, req.personalization, intent, prefs, anchor, remaining, None,
                list(intent.include_categories), excluded_ids, set(), None, weather)
            if cat_cands:
                must.add(cat_cands[0].poi.id)
        ctx, cands = await asyncio.to_thread(
            self._context_and_candidates, req.personalization, intent.model_copy(update={"include_categories": []}) if intent else None,
            prefs, anchor, remaining, None, None, excluded_ids, set(pending), None, weather)
        if must - {c.poi.id for c in cands}:
            extra_ctx, extra = await asyncio.to_thread(
                self._context_and_candidates, req.personalization, None, prefs, anchor, remaining, None, None, set(), set(),
                list(must), weather)
            cands = [*extra, *cands][:POOL + 2]
        pace = self._pace(req.personalization, prefs)
        prof = req.personalization.profile if (req.personalization and req.personalization.use_profile) else None
        max_walk = prof.max_walk_m if prof else None
        if prefs.less_walking:
            max_walk = min(max_walk or LESS_WALKING_MAX_M, LESS_WALKING_MAX_M)
        # keep the size of the walk the user agreed to (pending stops + explicitly requested ones)
        places = min(3, max(len(pending), len(must), 1)) if s.stops else ctx.places_count
        outcome = await self.planner.plan(
            start=current, candidates=cands, lang=req.lang, places_count=places, pace=pace, time_budget=remaining,
            max_walk_m=max_walk, weather=weather, wheelchair=ctx.wheelchair, must_ids=must, keep_ids=set(pending),
        )
        if prefs.indoor:  # the outdoor limit came from the user's request, not from the weather
            outcome.weather_effect = [n.model_copy(update={"code": n.code.replace("weather_", "indoor_")}) for n in outcome.weather_effect]
        route = self._route(outcome, current, pace, ctx, weather, wnotes, notes)

        # ---- 4. diff with the previous route, with reasons that match what really happened
        new_ids = [st.poi_id for st in route.stops]
        names = await asyncio.to_thread(self._names, list({*s.stops, *new_ids}), req.lang)
        cand_ids = {c.poi.id for c in cands}
        cat_of = {c.poi.id: c.poi.category for c in cands}
        capped = any(n.code.endswith("_cap_applied") for n in outcome.weather_effect)
        change = before
        change.after_total_minutes = route.totals.total_minutes if route.totals else None
        change.after_distance_m = route.totals.walk_distance_m if route.totals else None
        for pid in s.stops:
            if pid in new_ids:
                change.kept.append(ChangedStop(poi_id=pid, name=names.get(pid), reason="kept"))
                continue
            # a stop that still fitted every constraint but lost to better-matching places is "ranked_lower", not "time"
            reason = ("visited" if pid in visited else "skipped" if pid in skipped else "rejected" if pid in rejected
                      else "filtered" if pid not in cand_ids
                      else "ranked_lower" if pid in outcome.feasible_ids
                      else "outdoor_limit" if capped and cat_of.get(pid) not in INDOOR_CATEGORIES else "time_or_distance")
            change.removed.append(ChangedStop(poi_id=pid, name=names.get(pid), reason=reason))
        sel = {r.poi_id: r.reasons for r in route.explanation.selection}
        # interests that matched only through the walk's mood are reported as the mood, not as the user's interests
        sources = {st.poi_id: {m.source for m in st.matched_interests} for st in route.stops}
        for pid in new_ids:
            if pid not in s.stops:
                rs = sel.get(pid, [])
                reason = ("requested" if "requested" in rs else ("indoor_request" if prefs.indoor else "indoor_weather") if "indoor_weather" in rs
                          else ("matched_mood" if sources.get(pid) == {"mood"} else "matched_interest") if "matched_interest" in rs
                          else "close" if "close" in rs else "ranked")
                change.added.append(ChangedStop(poi_id=pid, name=names.get(pid), reason=reason))
        update.stops = new_ids
        route.message = await self._summary(req.lang, route, change)
        return ReplanResponse(route=route, change=change, session=update)

    # ------------------------------------------------------------------ db helpers

    def _poi(self, poi_id: int | None) -> Poi | None:
        if not poi_id:
            return None
        with self.session_factory() as db:
            return db.get(Poi, poi_id)

    def _names(self, ids: list[int], lang: str) -> dict[int, str | None]:
        if not ids:
            return {}
        with self.session_factory() as db:
            rows = db.query(Poi).filter(Poi.id.in_(ids)).all()
            return {p.id: (p.name_kk if lang == "kk" else p.name_ru) or p.name for p in rows}


def default_start() -> StartPoint:
    return StartPoint(latitude=CITY_CENTER[0], longitude=CITY_CENTER[1], source="default_city_center")

