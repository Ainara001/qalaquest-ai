import re
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from sqlalchemy import Select, and_, desc, func, literal, or_, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.integrations.osm_categories import CATEGORIES, CATEGORY_LABELS
from app.models import ImportRun, Poi
from app.schemas.poi import CategoryCount, PoiDetail, PoiItem, PoiList, PoiStats, SourceInfo

router = APIRouter(prefix="/pois", tags=["pois"])

Lang = Literal["ru", "kk"]
DISTANCE_METHOD = "geodesic_wgs84_straight_line"  # PostGIS ST_Distance on geography: not a walking distance
ATTRIBUTION = "© OpenStreetMap contributors (ODbL)"
LICENSE_URL = "https://www.openstreetmap.org/copyright"
MAX_LIMIT = 100
MAX_MAP_POINTS = 10000
MAX_RADIUS_M = 50_000


# ------------------------------------------------------------ dependencies

def get_lang(
    lang: Annotated[Lang | None, Query(description="Interface language: ru | kk (default: Accept-Language, then ru)")] = None,
    accept_language: Annotated[str | None, Header()] = None,
) -> Lang:
    if lang:
        return lang
    for part in (accept_language or "").split(","):
        code = part.split(";")[0].strip().lower()[:2]
        if code in ("ru", "kk"):
            return code  # type: ignore[return-value]
    return "ru"


class Filters:
    """Query parameters shared by list / map / nearby endpoints (validated by FastAPI)."""

    def __init__(
        self,
        category: Annotated[list[str] | None, Query(description="Category key; repeat or comma-separate for several")] = None,
        search: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
        latitude: Annotated[float | None, Query(ge=-90, le=90)] = None,
        longitude: Annotated[float | None, Query(ge=-180, le=180)] = None,
        radius: Annotated[int | None, Query(ge=1, le=MAX_RADIUS_M, description="Metres, used together with latitude/longitude")] = None,
    ):
        cats = [c.strip() for item in (category or []) for c in item.split(",") if c.strip()]
        unknown = [c for c in cats if c not in CATEGORIES]
        if unknown:
            raise HTTPException(422, f"Unknown category: {', '.join(unknown)}")
        if (latitude is None) != (longitude is None):
            raise HTTPException(422, "latitude and longitude must be given together")
        if radius is not None and latitude is None:
            raise HTTPException(422, "radius requires latitude and longitude")
        self.categories = cats
        self.search = search.strip() if search else None
        self.latitude, self.longitude, self.radius = latitude, longitude, radius


def _origin(f: Filters):
    return func.ST_SetSRID(func.ST_MakePoint(f.longitude, f.latitude), 4326).cast(Poi.geom.type)


def _like(term: str) -> str:
    return "%" + re.sub(r"([\\%_])", r"\\\1", term) + "%"


def _apply(stmt: Select, f: Filters) -> Select:
    if f.categories:
        stmt = stmt.where(Poi.category.in_(f.categories))
    if f.search:
        pat = _like(f.search)
        conds = [col.ilike(pat) for col in (Poi.name, Poi.name_ru, Poi.name_kk, Poi.name_en)]
        # typing a category name ("кафе", "мұражай") also matches that category
        needle = f.search.lower()
        for key, labels in CATEGORY_LABELS.items():
            if any(needle in label.lower() for label in labels.values()):
                conds.append(Poi.category == key)
        stmt = stmt.where(or_(*conds))
    if f.latitude is not None and f.radius is not None:
        stmt = stmt.where(func.ST_DWithin(Poi.geom, _origin(f), f.radius))
    return stmt


def _local_name(lang: str):
    return func.coalesce(Poi.name_ru if lang == "ru" else Poi.name_kk, Poi.name)


def _item(poi: Poi, lang: str, distance: float | None) -> dict:
    local = (poi.name_ru if lang == "ru" else poi.name_kk) or poi.name
    return {
        "id": poi.id, "osm_type": poi.osm_type, "osm_id": poi.osm_id,
        "name": local, "name_original": poi.name,
        "category": poi.category, "subcategory": poi.subcategory,
        "latitude": poi.latitude, "longitude": poi.longitude, "address": poi.address,
        "distance_m": round(distance, 1) if distance is not None else None,
        "distance_method": DISTANCE_METHOD if distance is not None else None,
    }


def _list(db: Session, f: Filters, lang: str, limit: int, offset: int) -> PoiList:
    base = _apply(select(Poi), f)
    total = db.scalar(select(func.count()).select_from(base.subquery()))
    if f.latitude is not None:
        dist = func.ST_Distance(Poi.geom, _origin(f)).label("distance")
        stmt = _apply(select(Poi, dist), f).order_by(dist, Poi.id)
    else:
        dist = literal(None).label("distance")
        stmt = _apply(select(Poi, dist), f).order_by(_local_name(lang).asc().nulls_last(), Poi.id)
    rows = db.execute(stmt.limit(limit).offset(offset)).all()
    return PoiList(items=[_item(p, lang, d) for p, d in rows], total=total or 0, limit=limit, offset=offset)


Limit = Annotated[int, Query(ge=1, le=MAX_LIMIT)]
Offset = Annotated[int, Query(ge=0, le=100_000)]


# --------------------------------------------------------------- endpoints

@router.get("", response_model=PoiList, summary="List POIs (filter, search, paginate)")
def list_pois(
    f: Annotated[Filters, Depends()],
    lang: Annotated[Lang, Depends(get_lang)],
    db: Annotated[Session, Depends(get_db)],
    limit: Limit = 20,
    offset: Offset = 0,
):
    return _list(db, f, lang, limit, offset)


@router.get("/nearby", response_model=PoiList, summary="POIs around a point, nearest first")
def nearby(
    latitude: Annotated[float, Query(ge=-90, le=90)],
    longitude: Annotated[float, Query(ge=-180, le=180)],
    lang: Annotated[Lang, Depends(get_lang)],
    db: Annotated[Session, Depends(get_db)],
    radius: Annotated[int, Query(ge=1, le=MAX_RADIUS_M, description="Metres")] = 1000,
    category: Annotated[list[str] | None, Query()] = None,
    search: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
    limit: Limit = 20,
    offset: Offset = 0,
):
    f = Filters(category=category, search=search, latitude=latitude, longitude=longitude, radius=radius)
    return _list(db, f, lang, limit, offset)


@router.get("/categories", response_model=list[CategoryCount], summary="Categories with object counts")
def categories(lang: Annotated[Lang, Depends(get_lang)], db: Annotated[Session, Depends(get_db)]):
    counts = dict(db.execute(select(Poi.category, func.count()).group_by(Poi.category)).all())
    return [
        CategoryCount(category=c, label=CATEGORY_LABELS[c][lang], count=counts[c])
        for c in CATEGORIES
        if counts.get(c)
    ]


@router.get("/stats", response_model=PoiStats, summary="Database coverage and freshness")
def stats(db: Annotated[Session, Depends(get_db)]):
    by_cat = dict(db.execute(select(Poi.category, func.count()).group_by(Poi.category)).all())
    last = db.execute(
        select(ImportRun).where(ImportRun.status.in_(("success", "partial"))).order_by(desc(ImportRun.finished_at)).limit(1)
    ).scalar_one_or_none()
    sources = db.execute(select(Poi.source, func.count()).group_by(Poi.source)).all()
    return PoiStats(
        total=sum(by_cat.values()),
        by_category=by_cat,
        last_successful_update=last.finished_at if last else None,
        osm_data_timestamp=last.osm_base_timestamp if last else None,
        sources=[SourceInfo(source=s, count=n, attribution=ATTRIBUTION, license_url=LICENSE_URL) for s, n in sources],
    )


@router.get("/map", summary="Compact GeoJSON of all matching POIs for the map")
def map_points(
    f: Annotated[Filters, Depends()],
    lang: Annotated[Lang, Depends(get_lang)],
    db: Annotated[Session, Depends(get_db)],
    response: Response,
):
    rows = db.execute(
        _apply(select(Poi.id, _local_name(lang), Poi.category, Poi.latitude, Poi.longitude), f)
        .order_by(Poi.id)
        .limit(MAX_MAP_POINTS)
    ).all()
    response.headers["Cache-Control"] = "public, max-age=60"
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "id": pid,
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {"id": pid, "name": name, "category": cat},
            }
            for pid, name, cat, lat, lon in rows
        ],
    }


@router.get("/{poi_id}", response_model=PoiDetail, summary="POI details")
def get_poi(
    poi_id: int,
    lang: Annotated[Lang, Depends(get_lang)],
    db: Annotated[Session, Depends(get_db)],
    latitude: Annotated[float | None, Query(ge=-90, le=90)] = None,
    longitude: Annotated[float | None, Query(ge=-180, le=180)] = None,
):
    if (latitude is None) != (longitude is None):
        raise HTTPException(422, "latitude and longitude must be given together")
    poi = db.get(Poi, poi_id)
    if poi is None:
        raise HTTPException(404, "POI not found")
    distance = None
    if latitude is not None:
        pt = func.ST_SetSRID(func.ST_MakePoint(longitude, latitude), 4326).cast(Poi.geom.type)
        distance = db.scalar(select(func.ST_Distance(Poi.geom, pt)).where(Poi.id == poi_id))

    own_desc = poi.description_ru if lang == "ru" else poi.description_kk
    return PoiDetail(
        **_item(poi, lang, distance),
        names={"original": poi.name, "ru": poi.name_ru, "kk": poi.name_kk, "en": poi.name_en},
        description=own_desc or poi.description,
        description_lang=lang if own_desc else None,
        opening_hours=poi.opening_hours, website=poi.website, phone=poi.phone,
        wheelchair=poi.wheelchair, indoor_outdoor=poi.indoor_outdoor, wikidata=poi.wikidata,
        source=poi.source, source_url=poi.source_url, source_updated_at=poi.source_updated_at,
        attribution=ATTRIBUTION, tags=poi.tags,
    )
