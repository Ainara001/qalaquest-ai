from datetime import datetime

from typing import Literal

from pydantic import BaseModel


class PoiItem(BaseModel):
    id: int
    osm_type: str
    osm_id: int
    name: str | None  # localized, falls back to the original OSM name
    name_original: str | None
    category: str
    subcategory: str | None
    latitude: float
    longitude: float
    address: str | None
    distance_m: float | None = None
    distance_method: str | None = None  # how distance_m was computed


class SuggestItem(PoiItem):
    match: Literal["exact", "prefix", "contains", "similar"]  # how the name matched (no AI involved)
    score: float  # trigram similarity 0..1 of the best name variant


class PoiList(BaseModel):
    items: list[PoiItem]
    total: int
    limit: int
    offset: int


class PoiDetail(PoiItem):
    names: dict[str, str | None]  # original / ru / kk / en as stored in OSM
    description: str | None  # localized description tag if present, else generic OSM description
    description_lang: str | None  # language of `description`, None = unspecified by OSM
    opening_hours: str | None
    website: str | None
    phone: str | None
    wheelchair: str | None
    indoor_outdoor: str | None
    wikidata: str | None
    source: str
    source_url: str | None
    source_updated_at: datetime | None
    attribution: str
    tags: dict


class CategoryCount(BaseModel):
    category: str
    label: str
    count: int


class SuggestResponse(BaseModel):
    query: str
    items: list[SuggestItem]  # best name matches first
    categories: list[CategoryCount]  # categories whose name matches the query ("кафе", "мұражай")


class SourceInfo(BaseModel):
    source: str
    count: int
    attribution: str
    license_url: str


class PoiStats(BaseModel):
    total: int
    by_category: dict[str, int]
    last_successful_update: datetime | None
    osm_data_timestamp: datetime | None
    sources: list[SourceInfo]
