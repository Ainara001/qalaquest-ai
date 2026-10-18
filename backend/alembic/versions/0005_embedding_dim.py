"""poi_index.embedding: resize to EMBEDDING_DIM (e.g. 384 for a small model on a free host)

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-18
"""
from alembic import op
from sqlalchemy import text

from app.core.config import get_settings

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def _resize(dim: int) -> None:
    bind = op.get_bind()
    current = bind.execute(
        text("SELECT atttypmod FROM pg_attribute WHERE attrelid = 'poi_index'::regclass AND attname = 'embedding'")
    ).scalar()
    if current == dim:
        return
    # vectors of another model are useless after a resize: drop them, re-run index_pois
    op.execute("DROP INDEX IF EXISTS ix_poi_index_embedding")
    op.execute("TRUNCATE poi_index")
    op.execute(f"ALTER TABLE poi_index ALTER COLUMN embedding TYPE vector({int(dim)})")
    op.execute("CREATE INDEX ix_poi_index_embedding ON poi_index USING hnsw (embedding vector_cosine_ops)")


def upgrade() -> None:
    _resize(get_settings().embedding_dim)


def downgrade() -> None:
    _resize(1024)
