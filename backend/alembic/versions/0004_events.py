"""events: dated local events (exhibitions, concerts, parties, theatre) from verified sources only

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-18
"""
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE events (
            id bigserial PRIMARY KEY,
            dedupe_key varchar(64) NOT NULL UNIQUE,
            title text NOT NULL,
            category varchar(16) NOT NULL CHECK (category IN ('exhibition','music','party','theatre','other')),
            venue text,
            poi_id bigint REFERENCES pois(id) ON DELETE SET NULL,
            latitude double precision,
            longitude double precision,
            geom geography(Point,4326) GENERATED ALWAYS AS (
                CASE WHEN latitude IS NULL OR longitude IS NULL THEN NULL
                     ELSE ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography END) STORED,
            start_at timestamptz,
            end_at timestamptz,
            organizer text,
            description text,
            price text,
            age_limit varchar(16),
            source_name varchar(100) NOT NULL,
            source_url text NOT NULL,
            verification_status varchar(16) NOT NULL DEFAULT 'source_listed'
                CHECK (verification_status IN ('source_listed','time_unconfirmed','place_unconfirmed')),
            last_checked_at timestamptz NOT NULL DEFAULT now(),
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_events_start ON events (start_at)")
    op.execute("CREATE INDEX ix_events_geom ON events USING gist (geom)")


def downgrade() -> None:
    op.execute("DROP TABLE events")
