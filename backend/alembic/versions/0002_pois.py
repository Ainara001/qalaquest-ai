"""pois and import_runs tables

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-18
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    op.create_table(
        "pois",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("osm_type", sa.String(8), nullable=False),
        sa.Column("osm_id", sa.BigInteger, nullable=False),
        sa.Column("name", sa.Text),
        sa.Column("name_ru", sa.Text),
        sa.Column("name_kk", sa.Text),
        sa.Column("name_en", sa.Text),
        sa.Column("description", sa.Text),
        sa.Column("description_ru", sa.Text),
        sa.Column("description_kk", sa.Text),
        sa.Column("category", sa.String(32), nullable=False),
        sa.Column("subcategory", sa.String(64)),
        sa.Column("tags", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("latitude", sa.Float, nullable=False),
        sa.Column("longitude", sa.Float, nullable=False),
        sa.Column("address", sa.Text),
        sa.Column("opening_hours", sa.Text),
        sa.Column("website", sa.Text),
        sa.Column("phone", sa.Text),
        sa.Column("wheelchair", sa.String(16)),
        sa.Column("indoor_outdoor", sa.String(16)),
        sa.Column("wikidata", sa.String(32)),
        sa.Column("source", sa.String(32), nullable=False, server_default="openstreetmap"),
        sa.Column("source_url", sa.Text),
        sa.Column("source_updated_at", sa.DateTime(timezone=True)),
        sa.Column("last_seen_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("osm_type", "osm_id", name="uq_pois_osm"),
        sa.CheckConstraint("osm_type IN ('node','way','relation')", name="ck_pois_osm_type"),
    )
    # `geom` is generated from latitude/longitude so the two can never disagree.
    op.execute(
        "ALTER TABLE pois ADD COLUMN geom geography(Point,4326) GENERATED ALWAYS AS "
        "(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED"
    )

    op.execute("CREATE INDEX ix_pois_geom ON pois USING gist (geom)")
    op.create_index("ix_pois_category", "pois", ["category"])
    for col in ("name", "name_ru", "name_kk"):
        op.execute(f"CREATE INDEX ix_pois_{col}_trgm ON pois USING gin ({col} gin_trgm_ops)")

    op.create_table(
        "import_runs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("osm_base_timestamp", sa.DateTime(timezone=True)),
        sa.Column("fetched", sa.Integer, nullable=False, server_default="0"),
        sa.Column("inserted", sa.Integer, nullable=False, server_default="0"),
        sa.Column("updated", sa.Integer, nullable=False, server_default="0"),
        sa.Column("skipped", sa.Integer, nullable=False, server_default="0"),
        sa.Column("details", postgresql.JSONB),
        sa.Column("error", sa.Text),
    )


def downgrade() -> None:
    op.drop_table("import_runs")
    op.drop_table("pois")
