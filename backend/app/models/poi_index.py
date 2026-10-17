from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import BigInteger, Computed, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

EMBEDDING_DIM = 1024  # intfloat/multilingual-e5-large; changing the model means a new migration


class PoiIndex(Base):
    """Searchable representation of a POI: text document, embedding and full-text vector."""

    __tablename__ = "poi_index"
    __table_args__ = (
        Index("ix_poi_index_embedding", "embedding", postgresql_using="hnsw", postgresql_ops={"embedding": "vector_cosine_ops"}),
        Index("ix_poi_index_tsv", "tsv", postgresql_using="gin"),
    )

    poi_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("pois.id", ondelete="CASCADE"), primary_key=True)
    doc: Mapped[str] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(String(64))
    model: Mapped[str] = mapped_column(String(100))
    embedding = mapped_column(Vector(EMBEDDING_DIM))
    tsv = mapped_column(TSVECTOR, Computed("to_tsvector('russian', doc)", persisted=True))
    indexed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
