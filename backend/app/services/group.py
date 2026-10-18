"""GroupRecommendationService (Group Harmony, stage 6): one walk for 2–5 people.

1. Common constraints (hard, the strictest member wins): time = the shortest time, pace = the slowest pace,
   budget = the strictest budget ("free" if anyone needs free), wheelchair access if anyone needs it, children if anyone
   has them. Applied as SQL filters by the existing retrieval — never relaxed by preferences.
2. One RAG search with every member's interests and mood (session level) → a pool of real candidate POIs.
3. Per-member fit of each candidate, from the same transparent tables as the personal ranking:
   fit = max over the member's interests (and mood interests × 0.9) of weight × category affinity, + 0.15 if a real OSM
   tag supports one of those interests; members without interests use the default sightseeing profile.
   Fits are normalised per member (divided by the member's best fit in the pool), so a member whose interests are
   rare in the data is not drowned out by the others.
4. Set selection (1–3 places): for every set, satisfaction of a member = their best normalised fit in the set;
   objective = 0.6 × min(satisfaction) + 0.4 × mean(satisfaction) + 0.1 × mean ranking score (distance, time, weather,
   data). The min term ("least satisfied member") stops one person's interests from dominating. Sets are checked with
   the existing RoutePlanningService against the common time budget (best feasible set wins).
5. The answer says, per member, which stops fit them and how well (a real calculation over categories and tags, not a
   guess about the place), and explains the compromise, including members nobody's choice could satisfy.
"""
import asyncio
import itertools
import logging
from dataclasses import dataclass, field

from app.rag.retrieval import Candidate, _tag_matches, retrieve
from app.rag.taxonomy import AFFINITY, DEFAULT_AFFINITY, MOOD_INTERESTS
from app.schemas.ai import Notice
from app.schemas.context import GroupMember, GroupPlace, GroupRequest, GroupResponse, MemberFit
from app.schemas.personalization import PersonalizationInput, SessionPreferences
from app.schemas.routes import StartPoint
from app.schemas.weather import WeatherAssessment
from app.services.context import assess_weather, build_context, resolve_start
from app.services.personalization import PersonalizationService
from app.services.recommendation import _card
from app.services.route_planning import RoutePlanningService, route_from_outcome

log = logging.getLogger("group")
POOL = 24
SET_POOL = 12
TRIES = 4
GOOD_FIT = 0.5
PACE_ORDER = ["slow", "normal", "active"]
BUDGET_ORDER = ["free", "2000", "5000", "10000", "any"]


def member_interests(m: GroupMember) -> dict[str, float]:
    out: dict[str, float] = {i: 1.0 for i in m.interests}
    if m.mood:
        for i, w in MOOD_INTERESTS[m.mood].items():
            out[i] = max(out.get(i, 0.0), 0.9 * w)
    if m.with_children:
        out["family"] = max(out.get("family", 0.0), 1.0)
    return out


def raw_fit(c: Candidate, interests: dict[str, float]) -> float:
    cat, tags = c.poi.category, c.poi.tags or {}
    if not interests:
        return DEFAULT_AFFINITY.get(cat, 0.2)
    best = max((w * AFFINITY.get(i, {}).get(cat, 0.0) for i, w in interests.items()), default=0.0)
    tag = any(_tag_matches(tags, i) for i in interests)
    return min(1.0, best + (0.15 if tag else 0.0))


@dataclass
class GroupPlanResult:
    chosen: list[Candidate]
    norm: dict[int, list[float]]  # poi id -> normalised fit per member
    satisfaction: list[float]  # per member, best normalised fit in the chosen set
    objective: float
    outcome: object | None
    sets_checked: int
    notices: list[Notice] = field(default_factory=list)


def common_constraints(members: list[GroupMember]) -> dict:
    times = [m.time_minutes for m in members if m.time_minutes]
    budgets = [m.budget for m in members if m.budget]
    paces = [m.pace for m in members if m.pace]
    return {
        "time_minutes": min(times) if times else None,
        "budget": min(budgets, key=BUDGET_ORDER.index) if budgets else None,
        "pace": min(paces, key=PACE_ORDER.index) if paces else "normal",
        "wheelchair": any(m.wheelchair for m in members),
        "with_children": any(m.with_children for m in members),
    }


def normalised_fits(cands: list[Candidate], members: list[GroupMember]) -> dict[int, list[float]]:
    per_member = [member_interests(m) for m in members]
    raw = {c.poi.id: [raw_fit(c, mi) for mi in per_member] for c in cands}
    best = [max((raw[c.poi.id][k] for c in cands), default=0.0) or 1.0 for k in range(len(members))]
    return {pid: [v / best[k] for k, v in enumerate(vals)] for pid, vals in raw.items()}


def rank_sets(cands: list[Candidate], norm: dict[int, list[float]], max_size: int) -> list[tuple[float, tuple[Candidate, ...]]]:
    """Every set of 1..max_size places from the best SET_POOL candidates, by group objective (largest sets first on ties)."""
    pool = cands[:SET_POOL]
    if not pool:
        return []
    lo, hi = min(c.final for c in pool), max(c.final for c in pool)
    rng = (hi - lo) or 1.0
    out = []
    for size in range(max_size, 0, -1):
        for combo in itertools.combinations(pool, size):
            sat = [max(norm[c.poi.id][k] for c in combo) for k in range(len(next(iter(norm.values()))))]
            base = sum((c.final - lo) / rng for c in combo) / len(combo)
            obj = 0.6 * min(sat) + 0.4 * (sum(sat) / len(sat)) + 0.1 * base
            out.append((round(obj, 4) + 0.001 * size, combo))  # tiny preference for more places at equal fit
    out.sort(key=lambda x: x[0], reverse=True)
    return out


class GroupRecommendationService:
    def __init__(self, emb, weather, planner: RoutePlanningService, session_factory) -> None:
        self.emb, self.weather, self.planner, self.session_factory = emb, weather, planner, session_factory
        self.personal = PersonalizationService(emb)

    def _candidates(self, req: GroupRequest, common: dict, anchor, weather: WeatherAssessment | None):
        interests: dict[str, float] = {}
        for m in req.members:
            for i, w in member_interests(m).items():
                interests[i] = max(interests.get(i, 0.0), w)
        p = (req.personalization or PersonalizationInput()).model_copy(deep=True)
        # the group's wishes are this session's conditions; a personal profile of the device owner is not used
        p.use_profile = False
        p.profile = None
        p.session = SessionPreferences(
            time_minutes=common["time_minutes"], budget=common["budget"],
            # only children change the company signal; "a group" says nothing about friends, a couple or colleagues
            company="family" if common["with_children"] else None,
            interests=[i for i, _ in sorted(interests.items(), key=lambda x: -x[1])][:8],
        )
        p.wheelchair = p.wheelchair or common["wheelchair"]
        rc = req.model_copy(update={"personalization": p, "time_minutes": common["time_minutes"] or req.time_minutes})
        with self.session_factory() as db:
            ctx = build_context(self.personal, db, rc, weather, req_children=common["with_children"] or None)
            ctx.full_visit_fit = True
            ctx.speed_m_per_min = {"slow": 60, "normal": 80, "active": 100}[common["pace"]]
            time_min = rc.time_minutes or 120
            reach = int(ctx.speed_m_per_min * time_min * 0.5 / 1.3)
            ctx.radius_m = min(max(ctx.radius_m, reach), req.radius_m or 20000)
            cands, _ = retrieve(db, self.emb, ctx, query_text=None, anchor=anchor, limit=POOL)
            return ctx, cands

    async def recommend(self, req: GroupRequest):
        anchor, used, notices = resolve_start(req)
        common = common_constraints(req.members)
        time_min = common["time_minutes"] or req.time_minutes or 120
        if not (common["time_minutes"] or req.time_minutes):
            notices.append(Notice(code="group_default_time", params={"minutes": time_min}))
        weather, wnotes = await assess_weather(self.weather, req.use_weather, anchor, time_min)
        notices += [n for n in wnotes if n.code != "weather_off"]
        ctx, cands = await asyncio.to_thread(self._candidates, req, common, anchor, weather)
        if not cands:
            notices.append(Notice(code="group_no_places"))
            return ctx, used, notices, weather, common, None
        norm = normalised_fits(cands, req.members)
        start = StartPoint(latitude=anchor[0], longitude=anchor[1], source="manual" if req.location else "default_city_center")
        checked = 0
        best: GroupPlanResult | None = None
        for obj, combo in rank_sets(cands, norm, req.places_count):
            if checked >= TRIES and best is None and len(combo) > 1:
                continue  # after a few infeasible multi-stop sets, only try single places
            if checked >= TRIES * 3:
                break
            checked += 1
            outcome = await self.planner.plan(start=start, candidates=list(combo), lang=req.lang, places_count=len(combo), pace=common["pace"],
                                              time_budget=time_min, max_walk_m=None, weather=weather, wheelchair=ctx.wheelchair,
                                              must_ids={c.poi.id for c in combo})
            if outcome.status != "no_feasible" and len(outcome.stops) == len(combo):
                sat = [max(norm[c.poi.id][k] for c in combo) for k in range(len(req.members))]
                best = GroupPlanResult(chosen=list(combo), norm=norm, satisfaction=sat, objective=obj, outcome=outcome, sets_checked=checked)
                break
        if best is None:
            notices.append(Notice(code="group_no_feasible", params={"minutes": time_min}))
            return ctx, used, notices, weather, common, None
        if len(best.chosen) < req.places_count:
            notices.append(Notice(code="route_fewer_stops", params={"requested": req.places_count, "planned": len(best.chosen)}))
        return ctx, used, notices, weather, common, best


def compromise_notes(req: GroupRequest, common: dict, result: GroupPlanResult, names: list[str]) -> list[Notice]:
    """Why this is the group's walk, in codes the UI renders (every statement comes from the calculation above)."""
    notes: list[Notice] = []
    n = len(req.members)
    for c in result.chosen:
        fans = [k for k in range(n) if result.norm[c.poi.id][k] >= GOOD_FIT]
        if len(fans) >= 2:
            notes.append(Notice(code="group_shared_place", params={"poi_id": c.poi.id, "count": len(fans), "total": n}))
    uncovered = [k for k in range(n) if result.satisfaction[k] < GOOD_FIT]
    if not uncovered:
        notes.append(Notice(code="group_everyone_covered", params={"total": n}))
    for k in uncovered:
        notes.append(Notice(code="group_member_not_covered", params={"member": names[k], "interests": ",".join(req.members[k].interests[:4])}))
    times = [m.time_minutes for m in req.members if m.time_minutes]
    if len(set(times)) > 1:
        notes.append(Notice(code="group_time_shortest", params={"minutes": common["time_minutes"]}))
    paces = {m.pace for m in req.members if m.pace}
    if len(paces) > 1:
        notes.append(Notice(code="group_pace_slowest", params={"pace": common["pace"]}))
    budgets = {m.budget for m in req.members if m.budget}
    if len(budgets) > 1:
        notes.append(Notice(code="group_budget_strictest", params={"budget": common["budget"]}))
    if common["wheelchair"]:
        notes.append(Notice(code="group_wheelchair_for_all"))
    if common["with_children"]:
        notes.append(Notice(code="group_children_for_all"))
    return notes


async def group_response(svc: GroupRecommendationService, req: GroupRequest) -> GroupResponse:
    ctx, used, notices, weather, common, result = await svc.recommend(req)
    names = [m.name or f"#{k + 1}" for k, m in enumerate(req.members)]
    if result is None:
        return GroupResponse(status="no_results", places=[], route=None, members=[], group_score=None, common=common, compromise=[],
                             sets_checked=0, used_location=used, notices=notices, weather=weather)
    n = len(req.members)
    by_id = {c.poi.id: c for c in result.chosen}
    order = [st.poi_id for st in result.outcome.stops]
    places = [
        GroupPlace(place=_card(by_id[pid], req.lang, ctx), members=[k for k in range(n) if result.norm[pid][k] >= GOOD_FIT],
                   fit=[round(v, 2) for v in result.norm[pid]])
        for pid in order if pid in by_id
    ]
    members = [
        MemberFit(index=k, name=req.members[k].name, satisfaction=round(result.satisfaction[k], 2),
                  level="high" if result.satisfaction[k] >= 0.8 else "medium" if result.satisfaction[k] >= GOOD_FIT else "low",
                  fits=[pid for pid in order if result.norm[pid][k] >= GOOD_FIT])
        for k in range(n)
    ]
    start = StartPoint(latitude=used.latitude, longitude=used.longitude, source="manual" if req.location else "default_city_center")
    route = route_from_outcome(result.outcome, start, common["pace"], ctx.info().interests, ctx.applied, weather)
    return GroupResponse(status="ok", places=places, route=route, members=members, group_score=round(result.objective, 3), common=common,
                         compromise=compromise_notes(req, common, result, names), sets_checked=result.sets_checked,
                         used_location=used, notices=notices, weather=weather)
