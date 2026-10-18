"""EmbeddingService: multilingual e5 embeddings (ru / kk / en) stored in pgvector."""
import logging
import threading

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Poi, PoiIndex
from app.rag.documents import build_document, content_hash

log = logging.getLogger("embeddings")
BATCH = 32


class EmbeddingService:
    """Lazy-loading wrapper around fastembed (ONNX, CPU). e5 models need "query: " / "passage: " prefixes."""

    def __init__(self) -> None:
        s = get_settings()
        self.model_name = s.embedding_model
        self.dim = s.embedding_dim
        self._cache_dir = s.embedding_cache_dir
        # only e5 models are trained with "query: " / "passage: " prefixes
        e5 = "e5" in self.model_name.lower()
        self._q, self._p = ("query: ", "passage: ") if e5 else ("", "")
        self._model = None
        self._lock = threading.Lock()

    @property
    def lexical(self) -> bool:
        # EMBEDDING_MODEL=none: no vectors at all (hosts without RAM for a model and without embedding quota);
        # the index keeps documents + full-text vectors, retrieval uses keywords, names, categories and ranking
        return self.model_name.lower() == "none"

    @property
    def remote(self) -> bool:
        # "gemini-embedding-001": vectors from the Gemini API, no model in memory (hosts with 512 MB RAM)
        return self.model_name.startswith("gemini")

    @property
    def ready(self) -> bool:
        return self.lexical or self._model is not None

    def _load(self):
        with self._lock:
            if self._model is None and self.remote:
                from google import genai

                key = get_settings().gemini_api_key
                if not key:
                    raise RuntimeError("GEMINI_API_KEY is required for Gemini embeddings")
                self._model = genai.Client(api_key=key)
            elif self._model is None:
                from fastembed import TextEmbedding

                log.info("loading embedding model %s", self.model_name)
                self._model = TextEmbedding(model_name=self.model_name, cache_dir=self._cache_dir)
                log.info("embedding model ready")
        return self._model

    def warm_up(self) -> None:
        if not self.lexical:
            self._load()

    def _embed_remote(self, texts: list[str], task: str) -> list[list[float]]:
        import time

        from google.genai import types

        client = self._load()
        out: list[list[float]] = []
        for i in range(0, len(texts), 100):  # API limit: 100 texts per request
            for attempt in range(6):
                try:
                    r = client.models.embed_content(
                        model=self.model_name, contents=texts[i : i + 100],
                        config=types.EmbedContentConfig(task_type=task, output_dimensionality=self.dim),
                    )
                    out.extend(list(e.values) for e in r.embeddings)
                    break
                except Exception as exc:  # free tier: 100 texts per minute → wait for the next minute and retry
                    if attempt == 5 or "429" not in str(exc) and "RESOURCE_EXHAUSTED" not in str(exc):
                        raise
                    log.warning("embedding quota hit, retrying in 60s")
                    time.sleep(60)
        return out

    def _embed(self, texts: list[str], task: str = "RETRIEVAL_DOCUMENT") -> list[list[float]]:
        if self.remote:
            vectors = self._embed_remote(texts, task)
            if vectors and len(vectors[0]) != self.dim:
                raise RuntimeError(f"model returns {len(vectors[0])}-d vectors, configured {self.dim}")
            return vectors
        model = self._load()
        with self._lock:  # ONNX session is shared; keep inference sequential
            vectors = [v.tolist() for v in model.embed(texts, batch_size=BATCH)]
        if vectors and len(vectors[0]) != self.dim:
            raise RuntimeError(f"model returns {len(vectors[0])}-d vectors, configured {self.dim}")
        return vectors

    def embed_query(self, query: str) -> list[float] | None:
        if self.lexical:
            return None
        return self._embed([f"{self._q}{query}"], "RETRIEVAL_QUERY")[0]

    def embed_passages(self, docs: list[str]) -> list[list[float] | None]:
        if self.lexical:
            return [None] * len(docs)
        return self._embed([f"{self._p}{d}" for d in docs])

    # ------------------------------------------------------------ indexing

    def index_all(self, session_factory, force: bool = False) -> dict:
        """Create or refresh embeddings. Unchanged documents (same hash + model) are skipped."""
        stats = {"total": 0, "embedded": 0, "skipped_unchanged": 0, "failed": 0}
        with session_factory() as s:
            existing = dict(s.execute(select(PoiIndex.poi_id, PoiIndex.content_hash)).all())
            pois = s.scalars(select(Poi).order_by(Poi.id)).all()
            todo: list[tuple[int, str, str]] = []
            for p in pois:
                stats["total"] += 1
                doc = build_document(p)
                h = content_hash(doc, self.model_name)
                if not force and existing.get(p.id) == h:
                    stats["skipped_unchanged"] += 1
                else:
                    todo.append((p.id, doc, h))

        # remote free tier counts every text: 90 per batch, one batch a minute, leaving room for user queries
        batch = 90 if self.remote else 500 if self.lexical else BATCH
        for i in range(0, len(todo), batch):
            chunk = todo[i : i + batch]
            if self.remote and i:
                import time

                time.sleep(61)
            try:
                vectors = self.embed_passages([d for _, d, _ in chunk])
                rows = [
                    {"poi_id": pid, "doc": doc, "content_hash": h, "model": self.model_name, "embedding": vec}
                    for (pid, doc, h), vec in zip(chunk, vectors)
                ]
                with session_factory() as s:
                    stmt = insert(PoiIndex).values(rows)
                    stmt = stmt.on_conflict_do_update(
                        index_elements=["poi_id"],
                        set_={c: stmt.excluded[c] for c in ("doc", "content_hash", "model", "embedding")}
                        | {"indexed_at": text("now()")},
                    )
                    s.execute(stmt)
                    s.commit()
                stats["embedded"] += len(chunk)
                log.info("indexed %d/%d", min(i + batch, len(todo)), len(todo))
            except Exception:  # one bad batch must not stop the rest
                log.exception("batch %d failed", i // batch)
                stats["failed"] += len(chunk)
        return stats


_service: EmbeddingService | None = None


def get_embedding_service() -> EmbeddingService:
    global _service
    if _service is None:
        _service = EmbeddingService()
    return _service
