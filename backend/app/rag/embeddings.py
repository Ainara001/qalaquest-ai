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
    def ready(self) -> bool:
        return self._model is not None

    def _load(self):
        with self._lock:
            if self._model is None:
                from fastembed import TextEmbedding

                log.info("loading embedding model %s", self.model_name)
                self._model = TextEmbedding(model_name=self.model_name, cache_dir=self._cache_dir)
                log.info("embedding model ready")
        return self._model

    def warm_up(self) -> None:
        self._load()

    def _embed(self, texts: list[str]) -> list[list[float]]:
        model = self._load()
        with self._lock:  # ONNX session is shared; keep inference sequential
            vectors = [v.tolist() for v in model.embed(texts, batch_size=BATCH)]
        if vectors and len(vectors[0]) != self.dim:
            raise RuntimeError(f"model returns {len(vectors[0])}-d vectors, configured {self.dim}")
        return vectors

    def embed_query(self, query: str) -> list[float]:
        return self._embed([f"{self._q}{query}"])[0]

    def embed_passages(self, docs: list[str]) -> list[list[float]]:
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

        for i in range(0, len(todo), BATCH):
            chunk = todo[i : i + BATCH]
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
                log.info("indexed %d/%d", min(i + BATCH, len(todo)), len(todo))
            except Exception:  # one bad batch must not stop the rest
                log.exception("batch %d failed", i // BATCH)
                stats["failed"] += len(chunk)
        return stats


_service: EmbeddingService | None = None


def get_embedding_service() -> EmbeddingService:
    global _service
    if _service is None:
        _service = EmbeddingService()
    return _service
