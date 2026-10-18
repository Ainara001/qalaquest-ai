from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.rag.taxonomy import CategoryKey, Interest
from app.schemas.personalization import PersonalizationInput
from app.schemas.weather import WeatherAssessment

AiLang = Literal["ru", "kk"]
AnswerLang = Literal["ru", "kk", "en"]
Transport = Literal["walk", "bike", "car", "transit"]
Budget = Literal["free", "low", "any"]


class GeoPoint(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


# --------------------------------------------------------------- requests

class AiRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    lang: AiLang = "ru"
    location: GeoPoint | None = None
    time_minutes: int | None = Field(default=None, ge=5, le=600)
    radius_m: int | None = Field(default=None, ge=100, le=20000)
    categories: list[CategoryKey] | None = Field(default=None, max_length=16)
    exclude_categories: list[CategoryKey] | None = Field(default=None, max_length=16)
    free_only: bool | None = None
    with_children: bool | None = None
    interests: list[Interest] | None = Field(default=None, max_length=8)  # session-only hints from the profile page
    anchor_poi_id: int | None = Field(default=None, ge=1)  # "start from this place" (from the map)
    personalization: PersonalizationInput | None = None
    use_weather: bool = False  # stage 6: also rank with the current weather assessment

    @field_validator("message")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("message must not be empty")
        return v


class ChatRequest(AiRequest):
    session_id: str = Field(pattern=r"^[A-Za-z0-9_-]{8,64}$")


class SearchRequest(BaseModel):
    query: str | None = Field(default=None, max_length=300)
    lang: AiLang = "ru"
    location: GeoPoint | None = None
    radius_m: int | None = Field(default=None, ge=100, le=20000)
    time_minutes: int | None = Field(default=None, ge=5, le=600)
    interests: list[Interest] | None = Field(default=None, max_length=8)
    categories: list[CategoryKey] | None = Field(default=None, max_length=16)
    exclude_categories: list[CategoryKey] | None = Field(default=None, max_length=16)
    free_only: bool | None = None
    wheelchair: bool | None = None
    transport: Transport = "walk"
    limit: int = Field(default=10, ge=1, le=20)
    personalization: PersonalizationInput | None = None
    use_weather: bool = False  # stage 6: rank with the current weather assessment of the start point
    exclude_poi_ids: list[int] = Field(default_factory=list, max_length=100)


# ------------------------------------------------- LLM structured outputs

class QueryIntent(BaseModel):
    """What the user wants, extracted by the LLM. Empty/None means "not stated"."""

    needs_clarification: bool = False
    clarification_question: str | None = Field(default=None, max_length=300)
    start_place: str | None = Field(default=None, max_length=120)
    time_minutes: int | None = Field(default=None, ge=5, le=600)
    interests: list[Interest] = Field(default_factory=list, max_length=8)
    include_categories: list[CategoryKey] = Field(default_factory=list, max_length=16)
    exclude_categories: list[CategoryKey] = Field(default_factory=list, max_length=16)
    activity: str | None = Field(default=None, max_length=120)
    max_distance_m: int | None = Field(default=None, ge=100, le=20000)
    budget: Budget | None = None
    atmosphere: Literal["quiet", "lively", "family", "romantic"] | None = None
    transport: Transport | None = None
    with_children: bool | None = None
    wheelchair: bool | None = None
    want_alternatives: bool = False
    ignore_preferences: bool = False
    less_walking: bool = False  # "я устал", "хочу меньше ходить"
    go_indoor: bool = False  # "хочу зайти в помещение", "стало холодно"
    finish_now: bool = False  # "заканчиваю прогулку"
    answer_language: AnswerLang | None = None
    semantic_query: str = Field(default="", max_length=200)


class LLMPick(BaseModel):
    poi_id: int
    reason: str = Field(max_length=500)
    activity_idea: str = Field(max_length=300)


class LLMRecommendations(BaseModel):
    intro: str = Field(max_length=400)
    picks: list[LLMPick] = Field(default_factory=list, max_length=3)
    limitations: str | None = Field(default=None, max_length=400)
    follow_up_question: str | None = Field(default=None, max_length=300)


# -------------------------------------------------------------- responses

class Source(BaseModel):
    name: str
    url: str | None
    attribution: str


class Confidence(BaseModel):
    level: Literal["high", "medium", "low"]
    verified_fields: list[str]
    missing_fields: list[str]


class Estimate(BaseModel):
    minutes: int
    basis: str  # machine-readable explanation, rendered by the UI


class RankingScores(BaseModel):
    weather: float = 0.5
    semantic: float
    interest: float
    location: float
    time: float
    budget: float
    context: float
    feedback: float
    data: float
    final: float


class InterestMatch(BaseModel):
    interest: str
    source: Literal["request", "session", "mood", "profile"]


class Explanation(BaseModel):
    """Why this place was recommended — derived from the ranking, not written by the LLM."""

    personalized: bool
    matched_interests: list[InterestMatch]
    matched_tags: list[str]  # real OSM tags that support a matched interest, e.g. "historic=memorial"
    favorite_category: bool
    feedback: list[str]  # category_liked | similar_to_liked | category_disliked | visited_before | marked_not_interested
    constraints: list["Notice"]  # hard/soft conditions applied to the whole search
    facts_used: list[str]  # source fields that exist for this place
    scores: RankingScores
    # stage 6: what came from where — the mood of this walk and the weather assessment (category-level)
    mood: str | None = None
    weather_fit: Literal["indoor_in_adverse_weather", "outdoor_in_good_weather"] | None = None


class Recommendation(BaseModel):
    poi_id: int
    name: str | None
    name_original: str | None
    category: str
    subcategory: str | None
    latitude: float
    longitude: float
    address: str | None
    reason: str | None  # AI-generated, grounded in the facts below
    activity_idea: str | None  # AI-generated idea, not a fact about the place
    distance_m: float | None
    distance_method: Literal["geodesic_straight_line"] | None
    travel_estimate: Estimate | None  # rough ETA from the straight line, NOT a route
    visit_estimate: Estimate | None  # typical for the category, NOT place-specific
    opening_hours: str | None
    hours_status: Literal["known", "unknown"]
    # stage 7: computed from OSM opening_hours for the estimated arrival (Astana time); "unknown" = not confirmed
    open_status: Literal["open", "closed", "unknown"] = "unknown"
    website: str | None
    phone: str | None
    wheelchair: str | None
    fee: Literal["free", "paid", "unknown"]  # from OSM `fee` tag only
    source: Source
    confidence: Confidence
    explanation: Explanation


class Notice(BaseModel):
    """Machine-readable system note; the frontend renders it in the interface language."""

    code: str
    params: dict[str, str | int | float] = Field(default_factory=dict)


class UsedLocation(BaseModel):
    latitude: float
    longitude: float
    source: Literal["request", "anchor_poi", "default_city_center"]
    label: str | None = None


class SearchMeta(BaseModel):
    candidates_considered: int
    radius_m: int
    time_minutes: int | None
    transport: Transport
    interests: list[str]
    include_categories: list[str]
    exclude_categories: list[str]
    free_only: bool
    semantic_query: str | None
    embedding_model: str
    llm_model: str | None = None
    timings_ms: dict[str, int] = Field(default_factory=dict)


class PersonalizationInfo(BaseModel):
    used: bool  # persistent profile applied to this answer
    ignored_by_request: bool  # the user asked for something different this time
    interests: list[InterestMatch]
    mood: str | None
    budget: str
    places_count: int
    constraints: list[Notice]


class AiResponse(BaseModel):
    status: Literal["ok", "needs_clarification", "no_results"]
    message: str | None  # AI-written intro / clarification, in the answer language
    answer_language: AnswerLang
    recommendations: list[Recommendation]
    limitations: str | None = None
    follow_up_question: str | None = None
    notices: list[Notice] = Field(default_factory=list)
    used_location: UsedLocation | None = None
    explanation_unavailable: bool = False  # True when LLM text could not be validated
    meta: SearchMeta | None = None
    personalization: PersonalizationInfo | None = None
    session_id: str | None = None
    weather: WeatherAssessment | None = None  # set when the weather was used for ranking


class SearchResult(BaseModel):
    results: list[Recommendation]
    personalization: PersonalizationInfo | None = None
    used_location: UsedLocation | None
    notices: list[Notice]
    meta: SearchMeta
    weather: WeatherAssessment | None = None  # set when the weather was used for ranking

Explanation.model_rebuild()
