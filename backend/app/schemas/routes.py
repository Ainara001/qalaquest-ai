from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.rag.taxonomy import CategoryKey, Interest, Mood
from app.schemas.ai import AiLang, InterestMatch, Notice
from app.schemas.personalization import PersonalizationInput
from app.schemas.weather import WeatherAssessment

PointSource = Literal["geolocation", "manual", "anchor_poi", "last_visited", "route_start", "default_city_center"]


class Point(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class StartPoint(Point):
    source: PointSource = "manual"
    label: str | None = Field(default=None, max_length=120)


# ------------------------------------------------------------------ results

class RouteStop(BaseModel):
    poi_id: int
    name: str | None
    name_original: str | None
    category: str
    latitude: float
    longitude: float
    visit_minutes: int  # ESTIMATE, typical for the category
    visit_basis: Literal["typical_for_category"] = "typical_for_category"
    arrive_after_min: int  # minutes from the (re)start, estimate
    setting: Literal["usually_indoor", "usually_outdoor", "unknown"]  # category-level, not a fact about the building
    opening_hours: str | None
    hours_status: Literal["known", "unknown"]
    matched_interests: list[InterestMatch]
    source_url: str | None


class RouteLeg(BaseModel):
    to_poi_id: int
    distance_m: float
    walk_minutes: float
    distance_method: Literal["pedestrian_route", "geodesic_straight_line"]
    geometry: list[list[float]]  # [[lon, lat], ...]; empty when no real route is available


class RouteTotals(BaseModel):
    walk_distance_m: float
    walk_minutes: int
    visit_minutes: int  # estimate
    buffer_minutes: int
    total_minutes: int
    outdoor_minutes: int  # estimate: walking + visits at usually-outdoor places
    time_budget_min: int | None
    fits_budget: bool


class StopReason(BaseModel):
    poi_id: int
    reasons: list[str]  # codes: matched_interest, close, indoor_weather, kept, requested, favorite, liked_similar


class RouteExplanation(BaseModel):
    order: str  # shortest_walk_order | single_stop | best_score_order | straight_line_estimate
    preferences: list[InterestMatch]
    constraints: list[Notice]
    weather: WeatherAssessment | None
    weather_effect: list[Notice]
    selection: list[StopReason]
    missing_data: list[Notice]
    alternatives_considered: int


class Route(BaseModel):
    status: Literal["ok", "straight_line_only", "no_feasible"]
    routing_engine: str | None  # "valhalla-pedestrian" when a real walking route was computed
    pace: Literal["slow", "normal", "active"]
    walking_speed_kmh: float
    start: StartPoint
    stops: list[RouteStop]
    legs: list[RouteLeg]
    totals: RouteTotals | None
    explanation: RouteExplanation
    notices: list[Notice]
    message: str | None = None  # optional LLM summary of the computed facts
    computed_at: datetime


class ChangedStop(BaseModel):
    poi_id: int
    name: str | None
    reason: str


class RouteChange(BaseModel):
    kept: list[ChangedStop]
    removed: list[ChangedStop]
    added: list[ChangedStop]
    before_total_minutes: int | None
    after_total_minutes: int | None
    before_distance_m: float | None
    after_distance_m: float | None
    reasons: list[Notice]  # what changed in the conditions


# ------------------------------------------------------------------ requests

class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PlanRequest(_Strict):
    lang: AiLang = "ru"
    start: StartPoint
    poi_ids: list[int] | None = Field(default=None, min_length=1, max_length=3)  # chosen by the user / AI guide
    query: str | None = Field(default=None, max_length=300)  # optional theme for automatic selection
    categories: list[CategoryKey] | None = Field(default=None, max_length=16)
    time_minutes: int | None = Field(default=None, ge=10, le=480)
    places_count: int | None = Field(default=None, ge=1, le=3)
    use_weather: bool = True
    personalization: PersonalizationInput | None = None


class SessionPrefs(_Strict):
    less_walking: bool = False
    indoor: bool = False
    mood: Mood | None = None
    interests: list[Interest] = Field(default_factory=list, max_length=8)
    exclude_categories: list[CategoryKey] = Field(default_factory=list, max_length=16)


class RouteSessionIn(_Strict):
    """Client-held state of the current walk (the server keeps nothing between calls)."""

    id: str = Field(pattern=r"^[A-Za-z0-9_-]{8,64}$")
    version: int = Field(ge=1, le=10_000)
    started_at: datetime
    start: StartPoint
    current: StartPoint | None = None
    stops: list[int] = Field(default_factory=list, max_length=3)
    visited: list[int] = Field(default_factory=list, max_length=30)
    skipped: list[int] = Field(default_factory=list, max_length=30)
    rejected: list[int] = Field(default_factory=list, max_length=30)
    time_budget_min: int | None = Field(default=None, ge=10, le=480)
    remaining_min: int | None = Field(default=None, ge=0, le=480)
    prefs: SessionPrefs = Field(default_factory=SessionPrefs)
    last_total_minutes: int | None = None
    last_distance_m: float | None = None


EventType = Literal[
    "time_left", "less_walking", "tired", "want_food", "go_indoor", "visited", "skip", "reject", "add_poi",
    "location", "interests", "mood", "weather_refresh", "manual", "message",
]


class RouteEvent(_Strict):
    type: EventType
    minutes: int | None = Field(default=None, ge=0, le=480)
    poi_id: int | None = Field(default=None, ge=1)
    location: StartPoint | None = None
    interests: list[Interest] | None = Field(default=None, max_length=8)
    mood: Mood | None = None
    message: str | None = Field(default=None, min_length=1, max_length=500)


class ReplanRequest(_Strict):
    lang: AiLang = "ru"
    session: RouteSessionIn
    event: RouteEvent
    use_weather: bool = True
    personalization: PersonalizationInput | None = None


class SessionUpdate(BaseModel):
    """New client state to store after a replan."""

    version: int
    current: StartPoint | None
    stops: list[int]
    visited: list[int]
    skipped: list[int]
    rejected: list[int]
    remaining_min: int | None
    prefs: SessionPrefs
    finished: bool = False


class PlanResponse(BaseModel):
    route: Route


class ReplanResponse(BaseModel):
    route: Route
    change: RouteChange
    session: SessionUpdate
