"""Shared helpers that turn a RecommendationContext into the inputs of the existing pipeline.

Every stage 6 mode (mood-aware map, Surprise Me, AI Quest, Group Harmony) and the stage 5 Living Route go
through the same three steps, so the same mood, weather and profile produce the same ranking everywhere:

1. start point  — the user's point, else the city centre (always reported, never silently assumed);
2. weather      — optional Open-Meteo assessment for that point and time window (or an explicit notice);
3. context      — PersonalizationService.build (request > session/mood > profile) → PersonalContext,
                  which `app.rag.retrieval.retrieve` ranks against.
"""
from sqlalchemy.orm import Session

from app.rag.retrieval import CITY_CENTER
from app.schemas.ai import Notice, UsedLocation
from app.schemas.context import RecommendationContext
from app.schemas.weather import WeatherAssessment
from app.services.personalization import PersonalContext, PersonalizationService
from app.services.weather import WeatherService, WeatherUnavailable


def resolve_start(rc: RecommendationContext) -> tuple[tuple[float, float], UsedLocation, list[Notice]]:
    """The user's point if given, otherwise the city centre with a visible notice."""
    if rc.location:
        anchor = (rc.location.latitude, rc.location.longitude)
        return anchor, UsedLocation(latitude=anchor[0], longitude=anchor[1], source="request"), []
    used = UsedLocation(latitude=CITY_CENTER[0], longitude=CITY_CENTER[1], source="default_city_center")
    return CITY_CENTER, used, [Notice(code="default_start_point")]


async def assess_weather(service: WeatherService | None, use: bool, at: tuple[float, float], minutes: int) -> tuple[WeatherAssessment | None, list[Notice]]:
    """Weather assessment for a walk window, or None with a notice that says why it was not used."""
    if not use:
        return None, [Notice(code="weather_off")]
    if service is None:
        return None, [Notice(code="weather_unavailable")]
    try:
        rep = await service.report(at[0], at[1], window_minutes=max(30, minutes))
    except WeatherUnavailable:
        return None, [Notice(code="weather_unavailable")]
    notes = [Notice(code="weather_stale")] if rep.stale else []
    if rep.assessment.level != "comfortable":
        notes.append(Notice(code="weather_adapted", params={"conditions": ",".join(rep.assessment.conditions)}))
    return rep.assessment, notes


def build_context(personal: PersonalizationService, db: Session, rc: RecommendationContext,
                  weather: WeatherAssessment | None = None, **overrides) -> PersonalContext:
    """PersonalContext for a RecommendationContext; `overrides` are extra build() arguments (e.g. req_interests)."""
    kwargs = dict(
        p=rc.personalization, req_categories=rc.categories, req_exclude=rc.exclude_categories,
        req_time=rc.time_minutes, req_radius=rc.radius_m,
    )
    kwargs.update(overrides)
    ctx = personal.build(db, **kwargs)
    ctx.exclude_ids |= set(rc.exclude_poi_ids)
    ctx.weather = weather
    return ctx
