"""poi_index.embedding nullable: lexical mode (EMBEDDING_MODEL=none) keeps documents without vectors

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-18
"""
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE poi_index ALTER COLUMN embedding DROP NOT NULL")


def downgrade() -> None:
    op.execute("DELETE FROM poi_index WHERE embedding IS NULL")
    op.execute("ALTER TABLE poi_index ALTER COLUMN embedding SET NOT NULL")
