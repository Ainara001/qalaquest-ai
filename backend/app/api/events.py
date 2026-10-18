from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, literal, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db
from app.models import Event
from app.services.events import CATEGORIES, configured_sources, is_current_or_future, overlaps, window

router = APIRouter(prefix="/events", tags=["events"])
Category = Literal["exhibition", "music", "party", "theatre", "other"]


class EventItem(BaseModel):
    id: int
    title: str
    category: Category
    venue: str | None
    poi_id: int | None
    latitude: float | None  # null = venue not matched to a real POI; the event is not drawn on the map
    longitude: float | None
    start_at: datetime | None
    end_at: datetime | None
    organizer: str | None
    price: str | None  # only when the source states it
    age_limit: str | None
    source_name: str
    source_url: str
    verification_status: Literal["source_listed", "time_unconfirmed", "place_unconfirmed"]
    last_checked_at: datetime
    distance_m: float | None = None


class EventsResponse(BaseModel):
    sources_connected: int  # 0 → the UI says honestly that no event source is connected
    sources: list[str]
    last_checked_at: datetime | None
    window_start: datetime
    window_end: datetime
    items: list[EventItem]


@router.get("", response_model=EventsResponse, summary="Real dated events from verified sources (none are generated)")
def list_events(
    db: Annotated[Session, Depends(get_db)],
    when: Annotated[Literal["today", "tomorrow", "weekend", "evening", "upcoming"], Query()] = "upcoming",
    category: Annotated[list[Category] | None, Query()] = None,
    latitude: Annotated[float | None, Query(ge=-90, le=90)] = None,
    longitude: Annotated[float | None, Query(ge=-180, le=180)] = None,
    radius: Annotated[int | None, Query(ge=100, le=50_000)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
):
    if (latitude is None) != (longitude is None):
        raise HTTPException(422, "latitude and longitude must be given together")
    now = datetime.now(timezone.utc)
    lo, hi = window(when, now)
    sources = [s["name"] for s in configured_sources(get_settings().event_sources)]
    q = select(Event).where(Event.start_at.is_not(None), Event.start_at < hi)
    if category:
        q = q.where(Event.category.in_(category))
    dist = None
    if latitude is not None:
        pt = func.ST_SetSRID(func.ST_MakePoint(longitude, latitude), 4326).cast(Event.geom.type)
        dist = func.ST_Distance(Event.geom, pt)
        if radius:
            q = q.where(func.ST_DWithin(Event.geom, pt, radius))
    rows = db.execute(q.add_columns(dist if dist is not None else literal(None)).order_by(Event.start_at).limit(500)).all()
    items = [
        EventItem(**{c: getattr(e, c) for c in EventItem.model_fields if c != "distance_m"}, distance_m=round(d, 1) if d is not None else None)
        for e, d in rows
        if is_current_or_future(e.start_at, e.end_at, now) and overlaps(e.start_at, e.end_at, lo, hi)
    ][:limit]
    last = db.scalar(select(func.max(Event.last_checked_at)))
    return EventsResponse(sources_connected=len(sources), sources=sources, last_checked_at=last, window_start=lo, window_end=hi, items=items)


assert set(CATEGORIES) == {"exhibition", "music", "party", "theatre", "other"}
