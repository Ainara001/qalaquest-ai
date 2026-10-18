import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal, get_db
from app.models import PoiIndex
from app.rag.embeddings import get_embedding_service
from app.schemas.ai import AiRequest, AiResponse, ChatRequest, SearchRequest, SearchResult
from app.schemas.context import SurpriseRequest, SurpriseResponse
from app.services.ai_guard import RateLimiter, deduper, limiter, sessions
from app.services.llm import LLMInvalidOutput, LLMUnavailable, get_llm
from app.services.recommendation import RecommendationService
from app.services.surprise import SurpriseRecommendationService
from app.services.weather import get_weather

router = APIRouter(prefix="/ai", tags=["ai"])
search_limiter = RateLimiter(60)  # retrieval only (no Gemini calls): a looser limit
log = logging.getLogger("ai_api")

# User-safe messages; reasons never contain provider details or secrets.
UNAVAILABLE = {
    "not_configured": "AI is not configured on this server (GEMINI_API_KEY is missing).",
    "timeout": "The AI service did not answer in time. Please try again.",
    "rate_limited": "The AI service is busy right now. Please try again in a minute.",
    "auth": "The AI service rejected the server credentials.",
    "upstream": "The AI service is temporarily unavailable.",
    "no_model": "No suitable Gemini model is available for this API key.",
}


def _service() -> RecommendationService:
    return RecommendationService(get_llm(), get_embedding_service(), SessionLocal, get_weather())


def _client(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _ensure_index(db: Session) -> None:
    if not db.scalar(select(func.count()).select_from(PoiIndex)):
        raise HTTPException(503, "The vector index is empty. Run: python -m app.scripts.index_pois", headers={"X-Error-Code": "index_empty"})


async def _guarded(request: Request, key: str, factory, rate=limiter):
    """Rate limit + share one in-flight/just-finished result between identical requests."""
    task = deduper.lookup(key)
    if task is None:
        rate.hit(_client(request))
        task = deduper.start(key, factory)
    try:
        return await asyncio.shield(task)
    except LLMUnavailable as exc:
        raise HTTPException(503, UNAVAILABLE.get(exc.reason, UNAVAILABLE["upstream"]), headers={"X-Error-Code": f"ai_{exc.reason}"}) from None
    except LLMInvalidOutput:
        raise HTTPException(502, "The AI returned an unusable answer. Please try again.", headers={"X-Error-Code": "ai_invalid_output"}) from None


@router.get("/status", summary="Which AI features are available")
def status(db: Annotated[Session, Depends(get_db)]):
    emb, llm = get_embedding_service(), get_llm()
    return {
        "llm_configured": llm.configured,
        "llm_model": llm.model,
        "embedding_model": emb.model_name,
        "embedding_ready": emb.ready,
        "indexed_pois": db.scalar(select(func.count()).select_from(PoiIndex)) or 0,
    }


@router.post("/search", response_model=SearchResult, summary="Retrieval only: ranked real POIs with scoring metadata")
async def search(req: SearchRequest, request: Request, db: Annotated[Session, Depends(get_db)]):
    _ensure_index(db)
    key = deduper.key("search", _client(request), req.model_dump_json())
    return await _guarded(request, key, lambda: _service().search(req), search_limiter)


@router.post("/recommend", response_model=AiResponse, summary="One-shot AI recommendations (RAG + Gemini)")
async def recommend(req: AiRequest, request: Request, db: Annotated[Session, Depends(get_db)]):
    _ensure_index(db)
    key = deduper.key("rec", _client(request), req.model_dump_json())
    return await _guarded(request, key, lambda: _service().recommend(req))


@router.post("/chat", response_model=AiResponse, summary="Conversational recommendations with in-session context")
async def chat(req: ChatRequest, request: Request, db: Annotated[Session, Depends(get_db)]):
    _ensure_index(db)
    key = deduper.key("chat", _client(request), req.model_dump_json())
    return await _guarded(request, key, lambda: _service().recommend(req, sessions.get(req.session_id), req.session_id))


@router.post("/surprise", response_model=SurpriseResponse, summary="Surprise me: one relevant real place that is new for this user")
async def surprise(req: SurpriseRequest, request: Request, db: Annotated[Session, Depends(get_db)]):
    _ensure_index(db)
    key = deduper.key("surprise", _client(request), req.model_dump_json())

    async def run() -> SurpriseResponse:
        pick, used, notices, weather = await SurpriseRecommendationService(_service(), get_weather()).surprise(req, req.seed)
        if pick is None:
            return SurpriseResponse(status="no_results", place=None, reasons=[], novelty=None, relevance=None, idea_source="none",
                                    travel_minutes=None, visit_minutes=None, pool_size=0, used_location=used, notices=notices, weather=weather)
        return SurpriseResponse(status="ok", place=pick.card, reasons=pick.reasons, novelty=pick.novelty, relevance=pick.relevance,
                                idea_source=pick.idea_source, travel_minutes=pick.travel_minutes, visit_minutes=pick.visit_minutes,
                                pool_size=pick.pool_size, used_location=used, notices=notices, weather=weather)

    # without Gemini this is retrieval only, so the looser limit applies; with it, the AI limit protects the quota
    return await _guarded(request, key, run, limiter if get_llm().configured else search_limiter)


@router.delete("/chat/{session_id}", status_code=204, summary="Forget the conversation context of a session")
def clear_chat(session_id: str):
    sessions.clear(session_id)
