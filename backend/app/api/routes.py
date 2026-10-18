import asyncio
import math
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request

from app.db.session import SessionLocal
from app.integrations.valhalla import get_valhalla
from app.rag.embeddings import get_embedding_service
from app.schemas.routes import PlanRequest, PlanResponse, ReplanRequest, ReplanResponse, StartPoint
from app.schemas.transit import TransitRequest, TransitResponse
from app.services.transit import get_transit
from app.schemas.weather import WeatherReport
from app.services.ai_guard import RateLimiter, deduper
from app.services.living_route import LivingRouteService
from app.services.llm import LLMInvalidOutput, LLMUnavailable, get_llm
from app.services.route_planning import RoutePlanningService
from app.services.weather import ASTANA, WeatherUnavailable, get_weather

router = APIRouter(tags=["routes"])
route_limiter = RateLimiter(30)
weather_limiter = RateLimiter(60)
MAX_DISTANCE_FROM_CITY_KM = 40  # data and routing cover Astana; further away we refuse instead of guessing
SESSION_MAX_AGE = timedelta(hours=12)


def _service() -> LivingRouteService:
    return LivingRouteService(get_embedding_service(), get_llm(), get_weather(), RoutePlanningService(get_valhalla()), SessionLocal)


def _client(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _check_area(p: StartPoint | None) -> None:
    if p is None:
        return
    dlat = math.radians(p.latitude - ASTANA[0])
    dlon = math.radians(p.longitude - ASTANA[1]) * math.cos(math.radians(ASTANA[0]))
    if 6371 * math.hypot(dlat, dlon) > MAX_DISTANCE_FROM_CITY_KM:
        raise HTTPException(422, "The point is outside the Astana area covered by QalaQuest", headers={"X-Error-Code": "out_of_area"})


async def _run(request: Request, key: str, factory, limiter):
    task = deduper.lookup(key)
    if task is None:
        limiter.hit(_client(request))
        task = deduper.start(key, factory)
    try:
        return await asyncio.shield(task)
    except LLMUnavailable as exc:  # only free-text route messages need the LLM
        raise HTTPException(503, "AI is unavailable for free-text route changes; use the quick actions", headers={"X-Error-Code": f"ai_{exc.reason}"}) from None
    except LLMInvalidOutput:
        raise HTTPException(502, "The AI returned an unusable answer", headers={"X-Error-Code": "ai_invalid_output"}) from None


@router.get("/routes/status", summary="Is the pedestrian routing engine reachable?")
async def routing_status():
    info = await get_valhalla().engines()
    return {"engine": "valhalla-pedestrian", "available": info["available"], "active": info["active"], "engines": info["engines"],
            "attribution": "Routing: Valhalla on © OpenStreetMap contributors data"}


@router.post("/routes/plan", response_model=PlanResponse, summary="Plan a walk through 1–3 real POIs (real pedestrian routing)")
async def plan(req: PlanRequest, request: Request):
    _check_area(req.start)
    key = deduper.key("plan", _client(request), req.model_dump_json())
    route = await _run(request, key, lambda: _service().plan(req), route_limiter)
    return PlanResponse(route=route)


@router.post("/routes/replan", response_model=ReplanResponse, summary="Living Route: re-plan the current walk after an event")
async def replan(req: ReplanRequest, request: Request):
    started = req.session.started_at if req.session.started_at.tzinfo else req.session.started_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - started > SESSION_MAX_AGE:
        raise HTTPException(409, "This walk is too old; start a new one", headers={"X-Error-Code": "session_expired"})
    if req.event.type == "message" and not req.event.message:
        raise HTTPException(422, "message is required for a message event", headers={"X-Error-Code": "validation_error"})
    _check_area(req.event.location or req.session.current or req.session.start)
    key = deduper.key("replan", _client(request), req.model_dump_json())
    return await _run(request, key, lambda: _service().replan(req), route_limiter)


@router.post("/routes/transit", response_model=TransitResponse, summary="Bus / tram options between two points (OSM route data, no timetable)")
async def transit(req: TransitRequest, request: Request):
    _check_area(StartPoint(latitude=req.start.latitude, longitude=req.start.longitude))
    _check_area(StartPoint(latitude=req.destination.latitude, longitude=req.destination.longitude))
    key = deduper.key("transit", _client(request), req.model_dump_json())
    return await _run(
        request, key,
        lambda: get_transit().options((req.start.latitude, req.start.longitude), (req.destination.latitude, req.destination.longitude), req.max_walk_to_stop_m),
        route_limiter,
    )


Lat = Annotated[float, Query(ge=-90, le=90)]
Lon = Annotated[float, Query(ge=-180, le=180)]


async def _weather(request: Request, lat: float, lon: float, minutes: int) -> WeatherReport:
    weather_limiter.hit(_client(request))
    try:
        return await get_weather().report(lat, lon, window_minutes=minutes)
    except WeatherUnavailable:
        raise HTTPException(503, "Weather data is temporarily unavailable", headers={"X-Error-Code": "weather_unavailable"}) from None


@router.get("/weather/status", summary="Which weather providers answered last (HTTP status only, no secrets)")
async def weather_status():
    return get_weather().status()


@router.get("/weather/current", response_model=WeatherReport, summary="Current weather (Open-Meteo) + walk comfort for the next hour")
async def weather_current(request: Request, latitude: Lat = ASTANA[0], longitude: Lon = ASTANA[1]):
    rep = await _weather(request, latitude, longitude, 60)
    return rep.model_copy(update={"forecast": rep.forecast[:1]})


@router.get("/weather/forecast", response_model=WeatherReport, summary="Hourly forecast + comfort assessment for a walk window")
async def weather_forecast(request: Request, latitude: Lat = ASTANA[0], longitude: Lon = ASTANA[1],
                           minutes: Annotated[int, Query(ge=15, le=720, description="walk duration")] = 90):
    return await _weather(request, latitude, longitude, minutes)
