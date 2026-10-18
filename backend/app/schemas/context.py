"""RecommendationContext: one request-side context shared by every recommendation mode (stage 6).

The map (mood-aware layer), Surprise Me, AI Quest and Living Route all describe "who walks, where, how long,
in what mood" the same way, so they cannot drift into incompatible recommendation mechanisms:

| Concept (stage 6 spec)      | Field                                                        |
|-----------------------------|--------------------------------------------------------------|
| Location                    | `location` (device / chosen point; never stored server-side) |
| Language                    | `lang`                                                       |
| Mood                        | `personalization.session.mood` (current walk only)           |
| Interests                   | `personalization.profile.interests` (persistent) + `personalization.session.interests` (today) |
| TimeBudget                  | `time_minutes`                                               |
| MoneyBudget                 | `personalization.session.budget` > `personalization.profile.budget` |
| WalkingPreferences          | `personalization.profile` (pace, max walk, indoor/outdoor, places count) |
| AccessibilityConstraints    | `personalization.wheelchair` (a requirement, always applied) |
| WeatherContext              | `use_weather` → assessed by the server from Open-Meteo       |
| ExcludedCategories          | `exclude_categories` + `personalization.session.exclude_categories` + disliked |
| VisitedPoiIds               | `personalization.feedback.visited` (+ `exclude_poi_ids` for "not again in this session") |
| CurrentSessionPreferences   | `personalization.session`                                    |

Persistent preferences and current filters stay separate: the profile is only used with `use_profile=true`.
"""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.rag.taxonomy import CategoryKey, Mood, ProfileInterest
from app.schemas.ai import AiLang, GeoPoint, Notice, Recommendation, UsedLocation
from app.schemas.personalization import PersonalizationInput
from app.schemas.routes import Route
from app.schemas.weather import WeatherAssessment


class RecommendationContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lang: AiLang = "ru"
    location: GeoPoint | None = None
    radius_m: int | None = Field(default=None, ge=100, le=20000)
    time_minutes: int | None = Field(default=None, ge=5, le=600)
    categories: list[CategoryKey] | None = Field(default=None, max_length=16)
    exclude_categories: list[CategoryKey] | None = Field(default=None, max_length=16)
    use_weather: bool = True
    # places not to offer again in this session (e.g. earlier Surprise Me results); not a persistent dislike
    exclude_poi_ids: list[int] = Field(default_factory=list, max_length=100)
    personalization: PersonalizationInput | None = None


# ------------------------------------------------------------------ Surprise Me (stage 6)

class SurpriseRequest(RecommendationContext):
    """`exclude_poi_ids` carries the places already offered in this session, so "another option" never repeats."""

    seed: int | None = Field(default=None, ge=0, le=2_147_483_647)  # reproducible draws in tests; omitted by the app


class SurpriseResponse(BaseModel):
    status: Literal["ok", "no_results"]
    place: Recommendation | None  # a real POI card built from the database record
    # why it was chosen (codes rendered by the UI): mood, interests, new_category, unusual_category,
    # indoor_in_adverse_weather, outdoor_in_good_weather, close, not_shown_before
    reasons: list[str]
    novelty: float | None  # 1.0 = a category new for this user (history-based, not popularity)
    relevance: float | None  # personal ranking, normalised within the candidate pool
    idea_source: Literal["ai", "category", "none"]  # "category" = generic idea for this kind of place, shown as such
    travel_minutes: int | None  # straight line × 1.3 at the user's pace — an estimate, not a route
    visit_minutes: int | None  # typical for the category — an estimate
    pool_size: int  # relevant candidates the draw was made from
    used_location: UsedLocation
    notices: list[Notice]
    weather: WeatherAssessment | None = None


# ------------------------------------------------------------------ AI Quest (stage 6)

QuestType = Literal["explorer", "photo_hunt", "architecture", "history", "family", "city_secrets"]


class QuestRequest(RecommendationContext):
    quest_type: QuestType = "explorer"
    tasks_count: int = Field(default=3, ge=2, le=5)


class QuestTask(BaseModel):
    id: str
    poi_ids: list[int]  # the real places this task is about (1 for a stop, 2+ for a comparison)
    kind: Literal["visit", "photo", "observe", "compare", "rest"]
    template: str  # code rendered by the UI in RU/KK with `params`
    params: dict[str, str | int] = Field(default_factory=dict)
    facts: list[str] = Field(default_factory=list)  # confirmed OSM tags the task may refer to, e.g. "historic=memorial"
    text: str | None = None  # AI wording (validated); when absent the UI renders the template
    hours_unknown: bool = False


class Quest(BaseModel):
    id: str
    type: QuestType
    title: str | None  # AI title (validated) or None → the UI shows the localized quest type
    stops: list[int]
    tasks: list[QuestTask]
    estimated_minutes: int | None
    route: Route  # real pedestrian route (or labelled straight-line estimate) through the stops
    generated_by: Literal["template", "ai"]
    notices: list[Notice] = Field(default_factory=list)
    used_location: UsedLocation


# ------------------------------------------------------------------ Group Harmony (stage 6)

class GroupMember(BaseModel):
    """One participant, entered on this device (no accounts, nothing stored on the server)."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=30)
    interests: list[ProfileInterest] = Field(default_factory=list, max_length=8)
    mood: Mood | None = None
    budget: Literal["free", "2000", "5000", "10000", "any"] | None = None
    time_minutes: int | None = Field(default=None, ge=15, le=480)
    pace: Literal["slow", "normal", "active"] | None = None
    wheelchair: bool = False
    with_children: bool = False


class GroupRequest(RecommendationContext):
    members: list[GroupMember] = Field(min_length=2, max_length=5)
    places_count: int = Field(default=3, ge=1, le=3)


class MemberFit(BaseModel):
    index: int
    name: str | None
    satisfaction: float  # best normalised fit among the chosen places (0..1), computed from categories and OSM tags
    level: Literal["high", "medium", "low"]
    fits: list[int]  # chosen places that fit this member (normalised fit >= 0.5)


class GroupPlace(BaseModel):
    place: Recommendation
    members: list[int]  # indexes of members this place fits (normalised fit >= 0.5)
    fit: list[float]  # normalised fit per member


class GroupResponse(BaseModel):
    status: Literal["ok", "no_results"]
    places: list[GroupPlace]
    route: Route | None
    members: list[MemberFit]
    group_score: float | None  # 0.6 × least satisfied + 0.4 × average satisfaction + 0.1 × ranking
    common: dict[str, int | str | bool | None]  # strictest time / budget / pace / accessibility applied to everyone
    compromise: list[Notice]  # codes rendered by the UI
    sets_checked: int
    used_location: UsedLocation
    notices: list[Notice]
    weather: WeatherAssessment | None = None
