"""RoutePlanningService: choose 1–3 real POIs and their order, then get the real walking geometry.

Everything here is computed by code: walking distances/times come from Valhalla (pedestrian costing at the
user's pace), visit durations are labelled category estimates, and the LLM never touches the numbers.

Algorithm (n ≤ 9 candidates, ≤ 3 stops, so exhaustive search is cheap):
1. One Valhalla matrix call: start + candidates, all-to-all walking times/distances.
2. For every subset of up to `places_count` candidates (always containing `must_ids`) and every order:
   walk = Σ legs, visits = Σ typical visit minutes, buffer = max(3, 10 % of walk), total = walk + visits + buffer.
   Hard checks: total ≤ time budget, walking distance ≤ max walk, outdoor minutes ≤ weather cap.
3. Objective among feasible plans: Σ personal ranking score (+ continuity bonus for stops kept from the
   previous route) + small diversity bonus − time / distance usage penalties.
4. Fallbacks, each reported: relax the weather cap → fewer stops → "no feasible route" with the minimum needed.
5. One Valhalla route call for the chosen order → geometry and per-leg numbers.
"""
import itertools
import logging
import math
from dataclasses import dataclass, field

from app.integrations.valhalla import NoRoute, RoutingUnavailable, ValhallaClient
from app.rag.retrieval import Candidate
from app.rag.taxonomy import INDOOR_CATEGORIES, OUTDOOR_CATEGORIES, VISIT_MINUTES
from app.schemas.ai import InterestMatch, Notice
from app.schemas.routes import RouteLeg, RouteStop, RouteTotals, StartPoint, StopReason
from app.schemas.weather import WeatherAssessment

log = logging.getLogger("route_planning")
PACE_KMH = {"slow": 3.6, "normal": 4.8, "active": 6.0}
CONTINUITY_BONUS = 0.15
DIVERSITY_BONUS = 0.05


def buffer_minutes(walk_min: float) -> int:
    return max(3, round(walk_min * 0.10))


def setting_of(category: str) -> str:
    return "usually_indoor" if category in INDOOR_CATEGORIES else "usually_outdoor" if category in OUTDOOR_CATEGORIES else "unknown"


def _haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    (la1, lo1), (la2, lo2) = a, b
    h = math.sin(math.radians(la2 - la1) / 2) ** 2 + math.cos(math.radians(la1)) * math.cos(math.radians(la2)) * math.sin(math.radians(lo2 - lo1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


@dataclass
class Plan:
    order: list[Candidate]
    walk_s: float
    walk_m: float
    visit_min: int
    total_min: int
    outdoor_min: int
    score: float


@dataclass
class PlanOutcome:
    status: str  # ok | straight_line_only | no_feasible
    stops: list[RouteStop] = field(default_factory=list)
    legs: list[RouteLeg] = field(default_factory=list)
    totals: RouteTotals | None = None
    order_reason: str = "single_stop"
    selection: list[StopReason] = field(default_factory=list)
    notices: list[Notice] = field(default_factory=list)
    weather_effect: list[Notice] = field(default_factory=list)
    considered: int = 0
    min_needed_min: int | None = None
    # candidates that appeared in at least one plan satisfying every hard constraint (used to explain removals honestly)
    feasible_ids: set[int] = field(default_factory=set)


class RoutePlanningService:
    def __init__(self, valhalla: ValhallaClient) -> None:
        self.valhalla = valhalla

    async def plan(
        self,
        *,
        start: StartPoint,
        candidates: list[Candidate],
        lang: str,
        places_count: int,
        pace: str,
        time_budget: int | None,
        max_walk_m: int | None,
        weather: WeatherAssessment | None,
        wheelchair: bool = False,
        must_ids: set[int] | None = None,
        keep_ids: set[int] | None = None,
    ) -> PlanOutcome:
        must_ids, keep_ids = must_ids or set(), keep_ids or set()
        speed = PACE_KMH[pace]
        pool = candidates[:9]
        if not pool:
            return PlanOutcome(status="no_feasible", notices=[Notice(code="route_no_candidates")])
        points = [(start.latitude, start.longitude)] + [(c.poi.latitude, c.poi.longitude) for c in pool]

        straight = False
        try:
            matrix = await self.valhalla.matrix(points, speed, wheelchair)
        except (RoutingUnavailable, NoRoute):
            # no real routing: rank by straight-line estimates, but never present them as a route
            straight = True
            mps = speed * 1000 / 3600
            matrix = [[(d := _haversine(a, b), d * 1.3 / mps) for b in points] for a in points]

        cap = weather.outdoor_cap_min if weather and weather.level != "comfortable" else None
        k = min(places_count, len(pool))
        best, considered = None, 0
        feasible: set[int] = set()
        relaxed_cap = False
        for use_cap in ((True, False) if cap else (False,)):
            best = None
            for size in range(k, 0, -1):
                for subset in itertools.combinations(range(len(pool)), size):
                    ids = {pool[i].poi.id for i in subset}
                    if not must_ids <= ids:
                        continue
                    for perm in itertools.permutations(subset):
                        considered += 1
                        p = self._evaluate(perm, pool, matrix, time_budget, max_walk_m, cap if use_cap else None, keep_ids)
                        if p:
                            feasible.update(c.poi.id for c in p.order)
                        if p and (best is None or p.score > best.score):
                            best = p
                if best and best.order and len(best.order) == size:
                    break  # the largest feasible size wins (more places within the same budget)
            if best:
                relaxed_cap = cap is not None and not use_cap
                break

        outcome = PlanOutcome(status="ok", considered=considered, feasible_ids=feasible)
        if best is None:
            # nothing fits: report how much time the cheapest single stop would need
            singles = [self._evaluate((i,), pool, matrix, None, None, None, keep_ids) for i in range(len(pool))]
            singles = [s for s in singles if s]
            outcome.status = "no_feasible"
            outcome.min_needed_min = min((s.total_min for s in singles), default=None)
            if time_budget and outcome.min_needed_min and outcome.min_needed_min > time_budget:
                outcome.notices.append(Notice(code="route_time_too_short", params={"budget": time_budget, "needed": outcome.min_needed_min}))
            elif max_walk_m:
                outcome.notices.append(Notice(code="route_too_far", params={"max_walk_m": max_walk_m}))
            else:
                outcome.notices.append(Notice(code="route_no_path"))
            return outcome

        if cap is not None:
            if relaxed_cap:
                outcome.weather_effect.append(Notice(code="weather_cap_relaxed", params={"cap": cap}))
            else:
                outcome.weather_effect.append(Notice(code="weather_cap_applied", params={"cap": cap}))
        if len(best.order) < k:
            outcome.notices.append(Notice(code="route_fewer_stops", params={"requested": k, "planned": len(best.order)}))

        # order explanation: is this the shortest walk for the chosen set?
        if len(best.order) == 1:
            outcome.order_reason = "single_stop"
        else:
            idx = [pool.index(c) for c in best.order]
            walks = [self._walk(perm, matrix)[0] for perm in itertools.permutations(idx)]
            outcome.order_reason = "shortest_walk_order" if best.walk_s <= min(walks) + 1 else "best_score_order"

        # real geometry for the chosen order
        legs: list[RouteLeg] = []
        ordered_pts = [points[0]] + [(c.poi.latitude, c.poi.longitude) for c in best.order]
        if not straight:
            try:
                vlegs = await self.valhalla.route(ordered_pts, speed, wheelchair)
                legs = [
                    RouteLeg(to_poi_id=c.poi.id, distance_m=round(l.distance_m, 1), walk_minutes=round(l.duration_s / 60, 1),
                             distance_method="pedestrian_route", geometry=l.shape)
                    for c, l in zip(best.order, vlegs)
                ]
            except (RoutingUnavailable, NoRoute):
                straight = True
        if straight:
            outcome.status = "straight_line_only"
            outcome.order_reason = "straight_line_estimate"
            outcome.notices.append(Notice(code="routing_unavailable"))
            prev = ordered_pts[0]
            for c in best.order:
                pt = (c.poi.latitude, c.poi.longitude)
                d = _haversine(prev, pt)
                legs.append(RouteLeg(to_poi_id=c.poi.id, distance_m=round(d, 1), walk_minutes=round(d * 1.3 / (speed * 1000 / 60), 1),
                                     distance_method="geodesic_straight_line", geometry=[]))
                prev = pt

        walk_min = sum(l.walk_minutes for l in legs)
        walk_m = sum(l.distance_m for l in legs)
        visit = sum(VISIT_MINUTES.get(c.poi.category, 20) for c in best.order)
        buf = buffer_minutes(walk_min)
        total = math.ceil(walk_min + visit + buf)
        outdoor = math.ceil(walk_min + sum(VISIT_MINUTES.get(c.poi.category, 20) * (1 if c.poi.category in OUTDOOR_CATEGORIES else 0.5 if c.poi.category not in INDOOR_CATEGORIES else 0) for c in best.order))
        outcome.totals = RouteTotals(
            walk_distance_m=round(walk_m), walk_minutes=math.ceil(walk_min), visit_minutes=visit, buffer_minutes=buf,
            total_minutes=total, outdoor_minutes=outdoor, time_budget_min=time_budget,
            fits_budget=time_budget is None or total <= time_budget,
        )
        if time_budget and total > time_budget:  # route geometry slightly longer than the matrix estimate
            outcome.notices.append(Notice(code="route_over_budget", params={"budget": time_budget, "total": total}))

        arrive = 0.0
        for c, leg in zip(best.order, legs):
            arrive += leg.walk_minutes
            p = c.poi
            outcome.stops.append(RouteStop(
                poi_id=p.id, name=(p.name_kk if lang == "kk" else p.name_ru) or p.name, name_original=p.name, category=p.category,
                latitude=p.latitude, longitude=p.longitude, visit_minutes=VISIT_MINUTES.get(p.category, 20),
                arrive_after_min=round(arrive), setting=setting_of(p.category), opening_hours=p.opening_hours,
                hours_status="known" if p.opening_hours else "unknown",
                matched_interests=[InterestMatch(interest=i, source=s) for i, s in c.matched], source_url=p.source_url,
            ))
            arrive += VISIT_MINUTES.get(p.category, 20)
            reasons = []
            if p.id in must_ids:
                reasons.append("requested")
            if p.id in keep_ids:
                reasons.append("kept")
            if c.matched:
                reasons.append("matched_interest")
            if c.favorite:
                reasons.append("favorite")
            if "similar_to_liked" in c.feedback or "category_liked" in c.feedback:
                reasons.append("liked_similar")
            if weather and weather.level != "comfortable" and p.category in INDOOR_CATEGORIES:
                reasons.append("indoor_weather")
            if leg.distance_m < 600:
                reasons.append("close")
            outcome.selection.append(StopReason(poi_id=p.id, reasons=reasons or ["ranked"]))
        unknown_hours = sum(1 for s in outcome.stops if s.hours_status == "unknown")
        if unknown_hours:
            outcome.notices.append(Notice(code="hours_unknown", params={"count": unknown_hours}))
        outcome.legs = legs
        return outcome

    # ------------------------------------------------------------------ helpers

    @staticmethod
    def _walk(perm, matrix) -> tuple[float, float]:
        seq = [0] + [i + 1 for i in perm]
        t = d = 0.0
        for a, b in zip(seq, seq[1:]):
            cell = matrix[a][b]
            if cell is None:
                return math.inf, math.inf
            d += cell[0]
            t += cell[1]
        return t, d

    def _evaluate(self, perm, pool, matrix, budget, max_walk_m, cap, keep_ids) -> Plan | None:
        walk_s, walk_m = self._walk(perm, matrix)
        if math.isinf(walk_s):
            return None
        order = [pool[i] for i in perm]
        walk_min = walk_s / 60
        visit = sum(VISIT_MINUTES.get(c.poi.category, 20) for c in order)
        total = math.ceil(walk_min + visit + buffer_minutes(walk_min))
        outdoor = walk_min + sum(VISIT_MINUTES.get(c.poi.category, 20) * (1 if c.poi.category in OUTDOOR_CATEGORIES else 0.5 if c.poi.category not in INDOOR_CATEGORIES else 0) for c in order)
        if budget and total > budget:
            return None
        if max_walk_m and walk_m > max_walk_m:
            return None
        if cap is not None and outdoor > cap:
            return None
        score = sum(c.final + (CONTINUITY_BONUS if c.poi.id in keep_ids else 0) for c in order)
        score += DIVERSITY_BONUS * len({c.poi.category for c in order})
        score -= 0.15 * (total / budget if budget else walk_min / 90)
        score -= 0.10 * (walk_m / (max_walk_m or 3000))
        return Plan(order, walk_s, walk_m, visit, total, math.ceil(outdoor), score)


def route_from_outcome(outcome: PlanOutcome, start: StartPoint, pace: str, preferences: list[InterestMatch], constraints: list[Notice],
                       weather: WeatherAssessment | None) -> "Route":
    """Route response for a planner outcome (shared by AI Quest and Group Harmony)."""
    from datetime import datetime, timezone

    from app.schemas.routes import Route, RouteExplanation

    return Route(
        status=outcome.status, routing_engine="valhalla-pedestrian" if outcome.status == "ok" else None, pace=pace,
        walking_speed_kmh=PACE_KMH[pace], start=start, stops=outcome.stops, legs=outcome.legs, totals=outcome.totals,
        explanation=RouteExplanation(
            order=outcome.order_reason, preferences=preferences, constraints=constraints, weather=weather,
            weather_effect=outcome.weather_effect, selection=outcome.selection,
            missing_data=[n for n in outcome.notices if n.code == "hours_unknown"], alternatives_considered=outcome.considered,
        ),
        notices=[n for n in outcome.notices if n.code != "hours_unknown"], computed_at=datetime.now(timezone.utc),
    )
