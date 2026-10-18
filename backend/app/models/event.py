from datetime import datetime

from geoalchemy2 import Geography
from sqlalchemy import BigInteger, Computed, DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class Event(Base):
    """A dated event taken from a verified source (never generated). Unknown fields stay NULL."""

    __tablename__ = "events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    dedupe_key: Mapped[str] = mapped_column(String(64), unique=True)
    title: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(16))
    venue: Mapped[str | None] = mapped_column(Text)
    poi_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("pois.id", ondelete="SET NULL"))
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    geom = mapped_column(
        Geography("POINT", srid=4326, spatial_index=False),
        Computed("CASE WHEN latitude IS NULL OR longitude IS NULL THEN NULL "
                 "ELSE ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography END", persisted=True),
    )
    start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    organizer: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    price: Mapped[str | None] = mapped_column(Text)
    age_limit: Mapped[str | None] = mapped_column(String(16))
    source_name: Mapped[str] = mapped_column(String(100))
    source_url: Mapped[str] = mapped_column(Text)
    verification_status: Mapped[str] = mapped_column(String(16), server_default="source_listed")
    last_checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
