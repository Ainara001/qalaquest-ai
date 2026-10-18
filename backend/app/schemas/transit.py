from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.routes import Point


class TransitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: Point
    destination: Point
    max_walk_to_stop_m: int = Field(default=600, ge=150, le=1500)


class TransitStop(BaseModel):
    stop_id: str  # OSM node id or GTFS stop id
    name: str | None
    latitude: float
    longitude: float
    walk_m: float
    walk_minutes: int
    walk_method: Literal["pedestrian_route", "geodesic_straight_line"]


class TransitOption(BaseModel):
    mode: Literal["bus", "trolleybus", "tram", "share_taxi"]
    ref: str | None
    name: str | None
    direction_from: str | None
    direction_to: str | None
    operator: str | None
    board: TransitStop
    alight: TransitStop
    stops_count: int  # stops after boarding, up to and including the alighting stop (from the OSM route relation)
    ride_distance_m: int  # approximate: along the stop sequence
    ride_minutes: int  # ESTIMATE at an average city-bus speed; there is no timetable or real-time data
    total_minutes: int  # walk to stop + ride + walk from stop; waiting time is NOT included
    saves_minutes: int  # walking all the way minus total_minutes (can be <= 0)
    osm_url: str


class TransitResponse(BaseModel):
    options: list[TransitOption]
    walk_only_minutes: int
    walk_only_distance_m: float
    walk_method: Literal["pedestrian_route", "geodesic_straight_line"]
    routes_in_data: int  # distinct lines known to the service (coverage is partial)
    data_generated_at: str | None
    waiting_time_included: bool = False
    realtime: bool = False
    licence: str = "© OpenStreetMap contributors (ODbL)"
