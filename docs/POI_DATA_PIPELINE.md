# POI data pipeline

How real places of Astana get from OpenStreetMap into the QalaQuest database.

## Source

**OpenStreetMap**, read through the public **Overpass API** (`https://overpass-api.de`, with a second public instance as fallback; override with `OVERPASS_URLS`).

- Licence: **ODbL 1.0**. Every POI row stores `source = openstreetmap` and `source_url` (the object's page on openstreetmap.org). The UI shows "© OpenStreetMap contributors (ODbL)" in every POI card, and the map shows its own attribution (OpenFreeMap / OpenMapTiles / OSM).
- Wikidata is not queried; the `wikidata` tag, when present in OSM, is stored and linked from the POI card.
- No photos are imported or shown (no licensed source is wired in).

## Run it

```bash
docker compose exec backend python -m app.scripts.import_pois            # everything
docker compose exec backend python -m app.scripts.import_pois -c museum  # one category
docker compose exec backend python -m app.scripts.import_pois --dry-run  # fetch + classify only
```

A full run takes about 5–15 minutes because requests are sequential, 3 s apart, and the public Overpass servers regularly answer 502/504.

## Steps

1. **Boundary.** The administrative boundary of Astana (OSM relation `3087155`, `admin_level=4`) is downloaded and assembled into a (Multi)Polygon with Shapely (~800 km²).
2. **One query per category.** `app/integrations/osm_categories.py` maps OSM tags to the 16 internal categories. The same rule list generates the Overpass selectors and classifies the returned elements, so they cannot drift apart. Queries are limited to the city area (`area(id:3603087155)`) and only to the tags of that category; unnamed objects are skipped (exception: playgrounds). Result is requested with `out geom tags`.
3. **Geometry.** `node` → its coordinates. `way` → polygon (closed) or line. `relation` → outer ways merged and polygonised. The stored point is Shapely's `representative_point()`, which is guaranteed to lie on/inside the object, not the bounding-box centre.
4. **City check.** The point must lie inside the boundary polygon; otherwise the object is skipped.
5. **Normalisation.** `name`, `name:ru`, `name:kk`, `name:en`, `description[:ru|:kk]`, address (`addr:full` or street + house number), `opening_hours`, `website`, `phone`, `wheelchair` (only the 4 documented values), `indoor` → `indoor_outdoor`, `wikidata`, and the full tag set as JSONB. Nothing is guessed: a missing value stays `NULL`, and the UI says "unknown".
6. **Upsert.** `INSERT … ON CONFLICT (osm_type, osm_id) DO UPDATE`, one transaction per category.
7. **Run log.** A row in `import_runs` records start/finish, status (`success`, `partial`, `failed`), the OSM data timestamp, counters and per-category details.

## Idempotency and duplicates

- The identity of a POI is `(osm_type, osm_id)` (unique constraint). Re-running updates rows in place; `created_at` stays, `updated_at` and `last_seen_at` move.
- An object is classified into exactly one category (first matching rule), so it cannot appear twice via two queries; within a run, repeated keys are skipped.
- Two different OSM objects are **never merged** because they are near each other or share a name. One deliberate exception: OSM splits a pedestrian street into many ways; segments with the same name within 500 m of an already imported one (category `promenade`, subcategory `pedestrian_street`) are skipped so one street is not listed dozens of times.

## Reliability

- Timeouts: 180 s per request. Retries: up to 5 attempts with exponential backoff (5 s, 10 s, 20 s…), honouring `Retry-After`, alternating between the configured endpoints. HTTP 429/5xx, non-JSON bodies and Overpass "runtime error" remarks are treated as temporary.
- Requests are strictly sequential; no parallelism.
- A category that still fails after all retries is recorded as failed and the run continues; the final status is `partial`. Data already written is never rolled back and never half-written.
- Exit code: `0` for `success`/`partial`, `1` for `failed`.

## Freshness

- `pois.source_updated_at` = timestamp of the OSM database snapshot used (Overpass `timestamp_osm_base`).
- `pois.last_seen_at` = start of the last run that saw the object.
- `GET /api/pois/stats` returns `last_successful_update` and `osm_data_timestamp`; the home page shows the date.
- Objects deleted in OSM are **not** removed automatically. They stop updating `last_seen_at`, so stale rows can be found with `WHERE last_seen_at < <last full run>`. Pruning is left for a later stage.
- Refresh policy: run the importer manually or from cron (for example weekly).

## Limitations

- OSM coverage in Astana is uneven: names in Kazakh/Russian (`name:kk`, `name:ru`), opening hours, websites and phones are present only for a minority of objects. The UI shows the original name and "Working hours unknown" instead of inventing data.
- Some categories are small because the tag simply is not used in the city (for example `tourism=viewpoint` returned nothing; the category is hidden while it has no objects).
- Cafés and restaurants in OSM are those mapped by volunteers; the list is not a complete business directory.
- `playground` objects are mostly unnamed; the UI labels them by category.
- Public Overpass servers have no SLA and may rate-limit. Use `OVERPASS_URLS` to point to your own instance for heavy use.
- Distances in the POI list, cards and AI answers are straight-line geodesic distances (PostGIS `ST_Distance` on `geography`), not walking routes. Walking routes come from the pedestrian router (Valhalla, stage 5) and are always labelled as such.
- Map tiles come from OpenFreeMap, a free public service without an SLA; for production, self-host tiles or use a paid provider.
