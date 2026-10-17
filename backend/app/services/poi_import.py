"""OSM -> PostgreSQL POI import: geometry, normalisation, idempotent upsert."""
import logging
import time
from datetime import datetime, timezone

from shapely.geometry import LineString, MultiPoint, Point, Polygon, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import linemerge, polygonize, unary_union
from shapely.prepared import prep
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.integrations.osm_categories import CATEGORIES, classify, overpass_selectors
from app.integrations.overpass import OverpassClient, OverpassError
from app.models import ImportRun, Poi

log = logging.getLogger("poi_import")

ASTANA_RELATION_ID = 3087155  # OSM administrative boundary of Astana (admin_level=4)
ASTANA_AREA_ID = 3_600_000_000 + ASTANA_RELATION_ID
MIN_SEGMENT_GAP_M = 500  # same-named street segments closer than this are one street
SOURCE = "openstreetmap"


# ---------------------------------------------------------------- geometry

def _pts(coords: list[dict]) -> list[tuple[float, float]]:
    return [(c["lon"], c["lat"]) for c in coords]


def _way_geometry(pts: list[tuple[float, float]]) -> BaseGeometry | None:
    if len(pts) >= 4 and pts[0] == pts[-1]:
        poly = Polygon(pts)
        return poly if poly.is_valid else poly.buffer(0)
    return LineString(pts) if len(pts) >= 2 else (Point(pts[0]) if pts else None)


def element_geometry(el: dict) -> BaseGeometry | None:
    """Build a shapely geometry from an Overpass `out geom` element."""
    if el["type"] == "node":
        return Point(el["lon"], el["lat"])
    if el["type"] == "way":
        return _way_geometry(_pts(el.get("geometry", [])))

    outers, others, nodes = [], [], []
    for m in el.get("members", []):
        if m["type"] == "way" and m.get("geometry"):
            line = LineString(_pts(m["geometry"])) if len(m["geometry"]) >= 2 else None
            if line is not None:
                (outers if m.get("role") == "outer" else others).append(line)
        elif m["type"] == "node" and "lat" in m:
            nodes.append(Point(m["lon"], m["lat"]))
    lines = outers or others
    if lines:
        polys = list(polygonize(linemerge(lines)))
        if outers and polys:
            return unary_union(polys)
        return unary_union(lines)
    if nodes:
        return MultiPoint(nodes)
    return None


def representative_point(geom: BaseGeometry) -> tuple[float, float]:
    """A point guaranteed to lie on/inside the object (not just the bbox centre)."""
    p = geom.representative_point()
    return p.y, p.x  # lat, lon


def fetch_boundary(client: OverpassClient) -> BaseGeometry:
    data = client.query(f"[out:json][timeout:120];rel({ASTANA_RELATION_ID});out geom;")
    els = data.get("elements", [])
    if not els:
        raise OverpassError("Astana boundary relation not returned")
    geom = element_geometry(els[0])
    if geom is None or geom.geom_type not in ("Polygon", "MultiPolygon"):
        raise OverpassError("could not assemble Astana boundary polygon")
    return geom


# ----------------------------------------------------------- normalisation

def _first(tags: dict, *keys: str) -> str | None:
    for k in keys:
        v = tags.get(k)
        if v and v.strip():
            return v.strip()
    return None


def _address(tags: dict) -> str | None:
    street = tags.get("addr:street")
    house = tags.get("addr:housenumber")
    if tags.get("addr:full"):
        return tags["addr:full"].strip()
    parts = [p for p in (street, house) if p]
    return ", ".join(parts) if parts else None


def normalize(el: dict, geom: BaseGeometry, snapshot: datetime, seen_at: datetime) -> dict | None:
    tags = el.get("tags") or {}
    cls = classify(tags)
    if cls is None:
        return None
    category, subcategory, require_name = cls
    name = _first(tags, "name", "name:ru", "name:kk", "name:en")
    if require_name and not name:
        return None
    lat, lon = representative_point(geom)
    return {
        "osm_type": el["type"],
        "osm_id": el["id"],
        "name": name,
        "name_ru": _first(tags, "name:ru"),
        "name_kk": _first(tags, "name:kk"),
        "name_en": _first(tags, "name:en"),
        "description": _first(tags, "description"),
        "description_ru": _first(tags, "description:ru"),
        "description_kk": _first(tags, "description:kk"),
        "category": category,
        "subcategory": subcategory,
        "tags": tags,
        "latitude": lat,
        "longitude": lon,
        "address": _address(tags),
        "opening_hours": _first(tags, "opening_hours"),
        "website": _first(tags, "website", "contact:website", "url"),
        "phone": _first(tags, "phone", "contact:phone"),
        "wheelchair": tags.get("wheelchair") if tags.get("wheelchair") in ("yes", "no", "limited", "designated") else None,
        "indoor_outdoor": {"yes": "indoor", "no": "outdoor"}.get(tags.get("indoor", "")),
        "wikidata": _first(tags, "wikidata"),
        "source": SOURCE,
        "source_url": f"https://www.openstreetmap.org/{el['type']}/{el['id']}",
        "source_updated_at": snapshot,
        "last_seen_at": seen_at,
    }


def _haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    from math import asin, cos, radians, sin, sqrt

    (la1, lo1), (la2, lo2) = a, b
    h = sin(radians(la2 - la1) / 2) ** 2 + cos(radians(la1)) * cos(radians(la2)) * sin(radians(lo2 - lo1) / 2) ** 2
    return 2 * 6371000 * asin(sqrt(h))


# ------------------------------------------------------------------ upsert

UPDATE_COLS = [
    "name", "name_ru", "name_kk", "name_en", "description", "description_ru", "description_kk",
    "category", "subcategory", "tags", "latitude", "longitude", "address", "opening_hours",
    "website", "phone", "wheelchair", "indoor_outdoor", "wikidata", "source", "source_url",
    "source_updated_at", "last_seen_at",
]


def upsert(session: Session, rows: list[dict]) -> tuple[int, int]:
    """Insert new / update existing rows keyed by (osm_type, osm_id). Returns (inserted, updated)."""
    if not rows:
        return 0, 0
    stmt = insert(Poi).values(rows)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_pois_osm",
        set_={c: stmt.excluded[c] for c in UPDATE_COLS} | {"updated_at": text("now()")},
    ).returning(text("(xmax = 0) AS inserted"))
    flags = session.execute(stmt).scalars().all()
    inserted = sum(1 for f in flags if f)
    return inserted, len(flags) - inserted


# ------------------------------------------------------------------ runner

def run_import(
    session_factory,
    client: OverpassClient,
    categories: list[str] | None = None,
    dry_run: bool = False,
    pause: float = 3.0,
) -> dict:
    """Import POIs category by category.

    Each category is fetched and written in its own transaction, so a failure in
    one category never corrupts or rolls back what the others already stored.
    """
    categories = categories or CATEGORIES
    started = datetime.now(timezone.utc)
    totals = {"fetched": 0, "inserted": 0, "updated": 0, "skipped": 0}
    details: dict[str, dict] = {}
    failures: list[str] = []
    snapshot: datetime | None = None

    run_id = None
    if not dry_run:
        with session_factory() as s:
            # A previous run that was killed (OOM, Ctrl-C, lost terminal) never got to finalise itself.
            s.execute(
                text("UPDATE import_runs SET status='failed', finished_at=now(), error='interrupted' WHERE status='running'")
            )
            run = ImportRun(source=SOURCE, started_at=started, status="running")
            s.add(run)
            s.commit()
            run_id = run.id

    try:
        boundary = fetch_boundary(client)
        area_km2 = _area_km2(boundary)
        log.info("Astana boundary loaded: %s, ~%.0f km2", boundary.geom_type, area_km2)
        inside = prep(boundary)
        time.sleep(pause)

        seen: set[tuple[str, int]] = set()
        kept_segments: list[tuple[str, tuple[float, float]]] = []

        for category in categories:
            selectors = overpass_selectors(category)
            body = "".join(f"nwr{sel}(area.a);" for sel in selectors)
            ql = f"[out:json][timeout:180];area(id:{ASTANA_AREA_ID})->.a;({body});out geom tags;"
            stat = {"fetched": 0, "inserted": 0, "updated": 0, "skipped": 0}
            try:
                data = client.query(ql)
                snapshot = _parse_ts(data.get("osm3s", {}).get("timestamp_osm_base")) or snapshot or started
                rows: dict[tuple[str, int], dict] = {}
                for el in data.get("elements", []):
                    stat["fetched"] += 1
                    key = (el["type"], el["id"])
                    geom = element_geometry(el)
                    row = normalize(el, geom, snapshot, started) if geom is not None and not geom.is_empty else None
                    if row is None or key in seen or key in rows:
                        stat["skipped"] += 1
                        continue
                    if not inside.contains(Point(row["longitude"], row["latitude"])):
                        stat["skipped"] += 1  # outside the administrative boundary
                        continue
                    if row["subcategory"] == "pedestrian_street" and row["name"]:
                        pos = (row["latitude"], row["longitude"])
                        if any(n == row["name"] and _haversine_m(p, pos) < MIN_SEGMENT_GAP_M for n, p in kept_segments):
                            stat["skipped"] += 1  # another segment of the same street
                            continue
                        kept_segments.append((row["name"], pos))
                    rows[key] = row
                if not dry_run:
                    with session_factory() as s:
                        stat["inserted"], stat["updated"] = upsert(s, list(rows.values()))
                        s.commit()
                else:
                    stat["inserted"] = len(rows)
                seen.update(rows)
                log.info("category %-13s fetched=%d inserted=%d updated=%d skipped=%d", category, *(stat[k] for k in ("fetched", "inserted", "updated", "skipped")))
            except OverpassError as exc:
                failures.append(category)
                stat["error"] = str(exc)
                log.error("category %s FAILED: %s", category, exc)
            details[category] = stat
            for k in totals:
                totals[k] += stat[k]
            time.sleep(pause)
    except OverpassError as exc:
        failures = list(categories)
        details["_boundary"] = {"error": str(exc)}
        log.error("import aborted: %s", exc)

    if failures and len(failures) == len(categories):
        status = "failed"
    elif failures:
        status = "partial"
    else:
        status = "success"

    if run_id is not None:
        with session_factory() as s:
            run = s.get(ImportRun, run_id)
            run.finished_at = datetime.now(timezone.utc)
            run.status = status
            run.osm_base_timestamp = snapshot
            run.fetched, run.inserted, run.updated, run.skipped = (totals[k] for k in ("fetched", "inserted", "updated", "skipped"))
            run.details = details
            run.error = f"failed categories: {', '.join(failures)}" if failures else None
            s.commit()
    return {"status": status, "failed": failures, "totals": totals, "details": details, "dry_run": dry_run}


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _area_km2(geom: BaseGeometry) -> float:
    # Rough planar estimate at Astana's latitude; only used for a sanity log line.
    from math import cos, radians

    return geom.area * (111.32 * 111.32 * cos(radians(51.1)))
