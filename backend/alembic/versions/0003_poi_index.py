"""poi_index: documents, embeddings (pgvector) and full-text vectors

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-18
"""
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE poi_index (
            poi_id bigint PRIMARY KEY REFERENCES pois(id) ON DELETE CASCADE,
            doc text NOT NULL,
            content_hash varchar(64) NOT NULL,
            model varchar(100) NOT NULL,
            embedding vector(1024) NOT NULL,
            tsv tsvector GENERATED ALWAYS AS (to_tsvector('russian', doc)) STORED,
            indexed_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_poi_index_embedding ON poi_index USING hnsw (embedding vector_cosine_ops)")
    op.execute("CREATE INDEX ix_poi_index_tsv ON poi_index USING gin (tsv)")


def downgrade() -> None:
    op.execute("DROP TABLE poi_index")
