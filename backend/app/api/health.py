import logging

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db
from app.schemas.health import DatabaseStatus, HealthResponse

router = APIRouter(tags=["health"])
log = logging.getLogger(__name__)


@router.get("/health", response_model=HealthResponse)
def health(response: Response, db: Session = Depends(get_db)) -> HealthResponse:
    """Real health check: queries the database and the required extensions."""
    settings = get_settings()
    try:
        version = db.execute(text("SHOW server_version")).scalar_one()
        ext = dict(
            db.execute(
                text("SELECT extname, extversion FROM pg_extension WHERE extname IN ('postgis','vector')")
            ).all()
        )
        database = DatabaseStatus(
            connected=True,
            version=version,
            postgis=ext.get("postgis"),
            pgvector=ext.get("vector"),
        )
        ok = "postgis" in ext and "vector" in ext
    except SQLAlchemyError as exc:
        log.error("health check: database unavailable", exc_info=exc)
        database = DatabaseStatus(connected=False, error=type(exc).__name__)
        ok = False

    if not ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return HealthResponse(
        status="ok" if ok else "degraded",
        app=settings.app_name,
        version=settings.app_version,
        environment=settings.app_env,
        database=database,
    )
