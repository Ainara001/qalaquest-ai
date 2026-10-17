from datetime import datetime

from geoalchemy2 import Geography
from sqlalchemy import BigInteger, CheckConstraint, Computed, DateTime, Float, Index, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class Poi(Base):
    """A real place imported from OpenStreetMap. Unknown fields stay NULL."""

    __tablename__ = "pois"
    __table_args__ = (
        UniqueConstraint("osm_type", "osm_id", name="uq_pois_osm"),
        CheckConstraint("osm_type IN ('node','way','relation')", name="ck_pois_osm_type"),
        Index("ix_pois_geom", "geom", postgresql_using="gist"),
        Index("ix_pois_category", "category"),
        Index("ix_pois_name_trgm", "name", postgresql_using="gin", postgresql_ops={"name": "gin_trgm_ops"}),
        Index("ix_pois_name_ru_trgm", "name_ru", postgresql_using="gin", postgresql_ops={"name_ru": "gin_trgm_ops"}),
        Index("ix_pois_name_kk_trgm", "name_kk", postgresql_using="gin", postgresql_ops={"name_kk": "gin_trgm_ops"}),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    osm_type: Mapped[str] = mapped_column(String(8))
    osm_id: Mapped[int] = mapped_column(BigInteger)

    name: Mapped[str | None] = mapped_column(Text)
    name_ru: Mapped[str | None] = mapped_column(Text)
    name_kk: Mapped[str | None] = mapped_column(Text)
    name_en: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    description_ru: Mapped[str | None] = mapped_column(Text)
    description_kk: Mapped[str | None] = mapped_column(Text)

    category: Mapped[str] = mapped_column(String(32))
    subcategory: Mapped[str | None] = mapped_column(String(64))
    tags: Mapped[dict] = mapped_column(JSONB, server_default="{}")

    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    # Derived from latitude/longitude by the database, so the two can never disagree.
    geom = mapped_column(
        Geography("POINT", srid=4326, spatial_index=False),
        Computed("ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography", persisted=True),
    )

    address: Mapped[str | None] = mapped_column(Text)
    opening_hours: Mapped[str | None] = mapped_column(Text)
    website: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    wheelchair: Mapped[str | None] = mapped_column(String(16))
    indoor_outdoor: Mapped[str | None] = mapped_column(String(16))
    wikidata: Mapped[str | None] = mapped_column(String(32))

    source: Mapped[str] = mapped_column(String(32), server_default="openstreetmap")
    source_url: Mapped[str | None] = mapped_column(Text)
    # Timestamp of the OSM data snapshot the record came from (Overpass `timestamp_osm_base`).
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
