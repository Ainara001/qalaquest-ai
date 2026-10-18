"""Guest-profile data sent by the client with AI requests. Everything is validated; no weights accepted."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.rag.taxonomy import CategoryKey, Interest, Mood, ProfileInterest

Budget = Literal["free", "2000", "5000", "10000", "any"]
Pace = Literal["slow", "normal", "active"]
Setting = Literal["indoor", "outdoor", "any"]
Company = Literal["solo", "friends", "partner", "family"]
Ids = list[int]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")  # unknown keys (e.g. client-side "weights") are rejected


class UserPreferences(_Strict):
    """Persistent preferences (stored on the device; sent only when the user allows personalization)."""

    interests: list[ProfileInterest] = Field(default_factory=list, max_length=16)
    favorite_categories: list[CategoryKey] = Field(default_factory=list, max_length=16)
    disliked_categories: list[CategoryKey] = Field(default_factory=list, max_length=16)
    pace: Pace = "normal"
    budget: Budget = "any"
    walk_duration_min: int | None = Field(default=None, ge=15, le=480)
    max_walk_m: int | None = Field(default=None, ge=200, le=20000)
    setting: Setting = "any"
    places_count: int = Field(default=3, ge=1, le=3)
    with_children: bool = False  # only when the user set it


class SessionPreferences(_Strict):
    """Today's conditions; never persisted by the server."""

    mood: Mood | None = None
    time_minutes: int | None = Field(default=None, ge=5, le=600)
    budget: Budget | None = None
    company: Company | None = None
    interests: list[Interest] = Field(default_factory=list, max_length=8)
    exclude_categories: list[CategoryKey] = Field(default_factory=list, max_length=16)
    allow_unconfirmed_free: bool = False  # "show public spaces whose price is not stated"


class FeedbackSummary(_Strict):
    """Raw feedback (POI ids per action). The server derives every weight from these itself."""

    liked: Ids = Field(default_factory=list, max_length=300)
    more_like: Ids = Field(default_factory=list, max_length=300)
    not_interested: Ids = Field(default_factory=list, max_length=300)
    visited: Ids = Field(default_factory=list, max_length=300)
    never: Ids = Field(default_factory=list, max_length=300)
    saved: Ids = Field(default_factory=list, max_length=300)


class PersonalizationInput(_Strict):
    use_profile: bool = False
    profile: UserPreferences | None = None
    session: SessionPreferences | None = None
    feedback: FeedbackSummary | None = None
    wheelchair: bool = False  # accessibility need: a requirement, applied even with use_profile=false
