import logging
import os
import threading
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.router import api_router
from app.core.config import get_settings
from app.core.logging import setup_logging
from app.rag.embeddings import get_embedding_service

settings = get_settings()
setup_logging(settings.log_level)
log = logging.getLogger("app")

@asynccontextmanager
async def lifespan(_: FastAPI):
    # Load the embedding model in the background so the first AI request is not slow.
    if settings.auto_bootstrap_data:
        threading.Thread(target=_bootstrap_data, daemon=True).start()
    else:
        threading.Thread(target=lambda: get_embedding_service().warm_up(), daemon=True).start()
    yield


def _bootstrap_data() -> None:
    """Fill an empty database with real OSM POIs and (re)build missing embeddings. Idempotent."""
    from sqlalchemy import func, select

    from app.db.session import SessionLocal
    from app.models import Poi

    blog = logging.getLogger("bootstrap")
    try:
        with SessionLocal() as s:
            count = s.scalar(select(func.count()).select_from(Poi))
        if not count:
            from app.integrations.overpass import DEFAULT_ENDPOINTS, OverpassClient
            from app.services.poi_import import run_import

            blog.info("database is empty: importing POIs from OpenStreetMap")
            urls = os.getenv("OVERPASS_URLS")
            client = OverpassClient(endpoints=[u.strip() for u in urls.split(",")] if urls else DEFAULT_ENDPOINTS, user_agent="QalaQuestAI/0.2 (hackathon project)")
            try:
                result = run_import(SessionLocal, client, None, dry_run=False, pause=3.0)
            finally:
                client.close()
            blog.info("import: %s %s", result["status"], result["totals"])
        stats = get_embedding_service().index_all(SessionLocal)  # only new or changed POIs
        blog.info("index: %s", stats)
    except Exception:
        blog.exception("bootstrap failed")


app = FastAPI(
    lifespan=lifespan,
    title=settings.app_name,
    version=settings.app_version,
    description="Backend of QalaQuest AI — Discover Astana Your Way.",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Error-Code", "Retry-After"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    log.info(
        "request",
        extra={
            "extra_fields": {
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "ms": round((time.perf_counter() - start) * 1000, 1),
            }
        },
    )
    return response


def _error(status_code: int, code: str, message: str, details=None, headers=None) -> JSONResponse:
    body = {"error": {"code": code, "message": message}}
    if details is not None:
        body["error"]["details"] = details
    return JSONResponse(status_code=status_code, content=body, headers=headers)


@app.exception_handler(StarletteHTTPException)
async def http_error(_: Request, exc: StarletteHTTPException):
    # keep headers such as Retry-After and X-Error-Code; the code mirrors X-Error-Code when present
    code = (exc.headers or {}).get("X-Error-Code", "http_error")
    return _error(exc.status_code, code, str(exc.detail), headers=exc.headers)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    # ctx may hold exception objects (custom validators), which are not JSON serialisable
    details = jsonable_encoder(exc.errors(), custom_encoder={Exception: str})
    return _error(422, "validation_error", "Invalid request", details)


@app.exception_handler(Exception)
async def unhandled_error(request: Request, exc: Exception):
    log.error("unhandled error", exc_info=exc, extra={"extra_fields": {"path": request.url.path}})
    return _error(500, "internal_error", "Internal server error")


app.include_router(api_router)
