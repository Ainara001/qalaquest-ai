"""Unit tests of the stage 6 algorithms. They need no database, no network and no API key:
the SQL step is never reached (pure functions) or is replaced by in-memory rows.

Run:  pip install -r requirements-dev.txt && pytest -q   (from backend/)
"""
import os
import random

import pytest

# settings require a URL even though nothing connects in these tests
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://test:test@localhost:1/test")


class FakeEmbeddings:
    """Deterministic stand-in for the e5 model (only used for the taste vector, which these tests do not assert on)."""

    model_name = "fake"
    ready = True

    def embed_query(self, text: str) -> list[float]:
        rnd = random.Random(sum(map(ord, text)))
        return [rnd.random() for _ in range(8)]


@pytest.fixture
def emb() -> FakeEmbeddings:
    return FakeEmbeddings()


def make_candidate(pid: int, category: str, final: float = 0.5, tags: dict | None = None, distance: float = 300.0, hours: str | None = None,
                   matched: list[tuple[str, str]] | None = None):
    from app.models import Poi
    from app.rag.retrieval import Candidate

    poi = Poi(id=pid, name=f"Place {pid}", name_ru=f"Место {pid}", name_kk=None, category=category, tags=tags or {},
              latitude=51.12, longitude=71.43, opening_hours=hours)
    return Candidate(poi, distance, {}, final, matched or [])


@pytest.fixture
def cand():
    return make_candidate
