from fastapi import APIRouter

from app.api import ai, events, health, pois, routes

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(pois.router)
api_router.include_router(ai.router)
api_router.include_router(routes.router)
api_router.include_router(events.router)
