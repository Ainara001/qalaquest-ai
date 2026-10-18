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

from app.rag.taxonomy import CategoryKey
from app.schemas.ai import AiLang, GeoPoint, Notice, Recommendation, UsedLocation
from app.schemas.personalization import PersonalizationInput
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
