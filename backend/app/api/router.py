from fastapi import APIRouter

from app.api import ai, health, pois

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(pois.router)
api_router.include_router(ai.router)
