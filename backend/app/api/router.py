from fastapi import APIRouter

from app.api import health, pois

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(pois.router)
