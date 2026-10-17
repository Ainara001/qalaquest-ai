# QalaQuest AI — Project status

_Last updated: 2026-10-18 (stage 3)_

## Stages

| # | Stage | State |
|---|-------|-------|
| 1 | Architecture, infrastructure, UI shell | **Done** |
| 2 | Real POIs of Astana, interactive map, RU/KK UI | **Done** (see "Known issues") |
| 3 | RAG + AI, mobile-first light UI | **Done except one item**: real Gemini calls were not verified (no API key available) |
| 4–7 | Personalization, Living Route, Quest, Weather, Group Harmony, Surprise Me, English UI | Not started |

## Stage 3 plan (written before implementation, 2026-10-18)

Audit result: stage 1–2 intact (1030 real POIs, 139 with ru/kk names, pgvector 0.8.7 enabled, no embeddings table yet, no `GEMINI_API_KEY` configured anywhere on this machine).

1. **Index**: migration `0003` (`poi_index`: document, hash, `vector(1024)`, HNSW + tsvector); `EmbeddingService` on `intfloat/multilingual-e5-large` via fastembed/ONNX (covers ru/kk/en); `index_pois` CLI, re-embeds only changed documents.
2. **Retrieval**: hard filters in SQL (radius, excluded categories, fee, accessibility) → vector + keyword candidates → weighted rerank (semantic, keyword, interest↔category affinity, distance, data completeness) → diversity pick.
3. **AI layer**: `LLMService` (official `google-genai` SDK, model from config or auto-discovered), structured output with Pydantic, query understanding with session context, `RecommendationService` that validates every POI id and builds cards from database fields only.
4. **API**: `/api/ai/search` (retrieval only), `/api/ai/recommend`, `/api/ai/chat` with rate limiting, in-flight de-duplication, size limits, privacy-safe logs.
5. **UI**: light theme default, 4-tab mobile bottom nav (Home, Map, AI guide, Profile), new Home, AI Planner chat with place cards, mobile map with bottom sheet, Profile page; RU/KK for everything.
6. **Docs + verification**: `RAG_ARCHITECTURE.md`, `MOBILE_UI.md`, README, honest status. Anything that cannot be verified (Gemini without a key) is stated as such.

## Implemented

### Stage 1 (unchanged)
FastAPI skeleton (settings, CORS, JSON logs, unified error format, Swagger at `/api/docs`), Alembic, `GET /api/health` with real DB/PostGIS/pgvector checks, Docker Compose (db → backend → frontend with healthchecks), React/Vite/Tailwind UI shell with light/dark theme.

### Stage 2

**Data (OpenStreetMap via Overpass)** — see [POI_DATA_PIPELINE.md](POI_DATA_PIPELINE.md)
- `python -m app.scripts.import_pois` (CLI only): boundary of Astana from OSM, one narrow query per category, shapely representative points, point-in-boundary check, normalisation, idempotent upsert on `(osm_type, osm_id)`, retry/backoff/mirror fallback, per-category transactions, run log in `import_runs`.
- Tag → category rules in `backend/app/integrations/osm_categories.py` (16 categories).
- Real import result: **1030 POIs** (568 nodes, 462 ways) in 15 categories — playground 331, cafe 318, restaurant 168, mall 52, monument 47, park 35, sports 29, attraction 16, theatre 9, library 8, museum 8, architecture 3, promenade 2, gallery 2, public_space 2. `viewpoint` has 0 objects in OSM for Astana and is hidden. All coordinates lie inside the city boundary (lat 50.87–51.29, lon 71.24–71.72).

**Database** — migration `0002`
- `pois` (all spec fields; `geom geography(Point,4326)` is a *generated column* from latitude/longitude, GiST index; B-tree on category; `pg_trgm` GIN indexes on `name`, `name_ru`, `name_kk`; JSONB `tags`; unique `(osm_type, osm_id)`), `import_runs`.

**Backend API** (all accept `lang=ru|kk` or `Accept-Language`)
- `GET /api/pois` (category, search, latitude, longitude, radius in metres, limit ≤ 100, offset), `/nearby`, `/{id}`, `/categories`, `/stats`, `/map` (GeoJSON for the map, ≤ 10 000 points).
- Localised name with fallback to the original OSM name; descriptions are returned only as stored in OSM and flagged when their language is unknown. Free-text search also matches category names (RU and KK).
- Distances are straight-line geodesic (PostGIS `geography`) and returned with `distance_method`.
- Validation of coordinates, radius, pagination, category and language; consistent JSON errors. There is no HTTP endpoint that modifies data or runs the importer.

**Frontend**
- i18next, `ru.json` / `kk.json` (identical key sets, checked), RU default, `RU | ҚАЗ` switcher in the header, choice persisted in `localStorage` (`qq-lang`), `<html lang>` updated, switching does not reload or reset the map. Kazakh dates are formatted by hand (browsers often lack Kazakh ICU data).
- `/explore`: MapLibre GL map (OpenFreeMap tiles, light/dark style, labels in `name:kk`/`name:ru` where present), clustered GeoJSON source (no per-marker React components), colour-coded categories, click on a marker or cluster, category chips with counts, debounced search, geolocation button (graceful when denied) and manual point picking, radius slider with a circle on the map, distance with an explicit "straight line, not a walking route" note, POI detail (address, hours or "unknown", phone, website, wheelchair only if tagged, names in all languages, source link, ODbL attribution), desktop split layout and mobile bottom sheet.
- Home shows real category counts from `/api/pois/stats`, or "Data not loaded yet".
- The map page is code-split (MapLibre is ~800 kB).
- User coordinates live only in browser memory (not persisted, not stored server-side; request logs contain only paths).

### Stage 3 — actual results

**Implemented**
- `EmbeddingService` (`intfloat/multilingual-e5-large`, 1024-d, fastembed/ONNX, local), `poi_index` table (migration `0003`: document, hash, vector with HNSW, full-text vector), `index_pois` CLI (hash-based, skips unchanged, batch errors isolated), `import_pois --index`.
- Hybrid retrieval: SQL hard filters (radius, categories, fee, accessibility, time budget, exclusions) → vector + keyword + affinity + proximity + data-completeness rerank → diversity pick.
- `LLMService` (official `google-genai`, structured output, timeout, retry, error mapping, model from config or auto-discovered), query understanding with session context, `RecommendationService` with id and text validation, cards built from DB fields only.
- `POST /api/ai/search | recommend | chat`, `DELETE /api/ai/chat/{id}`, `GET /api/ai/status`; input limits, per-IP rate limit, double-submit sharing, privacy-safe logs; error codes exposed through CORS.
- UI: light theme by default, 4-tab bottom navigation with safe-area and keyboard handling, new Home with a real AI input and six quick scenarios, AI guide chat with place cards, map reworked for phones (floating search/chips/actions, bottom sheet, numbered AI pins), Profile (language, theme, session-only interests, clear conversation, geolocation explanation). ComingSoon pages for later stages were removed from the navigation.
- Docs: [RAG_ARCHITECTURE.md](RAG_ARCHITECTURE.md), [MOBILE_UI.md](MOBILE_UI.md), README.

**Numbers:** 1030 POIs indexed (0 failed; second run skipped 1030); first index run needed ~10 min on CPU after a ~2.2 GB model download; query embedding ≈ 0.2 s; embedding model load ≈ 16 s at backend start.

**Real queries run**
- Retrieval (`/api/ai/search`, real embeddings, no LLM): "музей истории", "саябақта серуендегім келеді" near Mega Silk Way, "a quiet coffee shop" (interest coffee), "что-нибудь необычное" with free + 60 min (radius 1292 m), 150 m radius, 10 minutes (no candidates), exclude museums.
- Full chat flow ("Я возле MEGA Silk Way. У меня 60 минут, люблю красивые места и хочу погулять бесплатно", follow-up "Не хочу музеи, предложи что-нибудь другое", Kazakh request, greeting, unknown start place, 5 minutes, tiny radius, invented id/time/price, 3 parallel identical requests) ran against a **local stand-in for the Gemini REST API**, not real Gemini.

**Verified**
- Backend: migration 0003, pgvector index, embedding + indexing, retrieval filters, validation errors (empty / too long / bad coordinates / session id / category / time → 422), rate limit (429), double submit (1 LLM call for 3 requests), logs free of message text and coordinates, `503` + `X-Error-Code: ai_not_configured` without a key, `ai_auth` with an invalid key against the real Gemini endpoint (network path and error mapping work), guard against invented ids / clock times / prices.
- Frontend (in-app browser): production build; Home, Guide, Map, Profile on a 375 × 812 phone viewport and a desktop width, light default after clearing storage, RU ↔ KK switch (and persistence), bottom navigation, composer next to the bottom bar, bottom bar hidden while the composer is focused, tapping "send" in that state, no horizontal overflow, AI cards rendering, "On the map" opening the map with a numbered pin and the bottom sheet, error card in Kazakh with a retry button, desktop map unchanged.

**Not verified / known issues**
- **Real Gemini generation is unverified**: no `GEMINI_API_KEY` exists on this machine. Reason / idea quality, structured-output behaviour of the chosen model and model auto-discovery against the real API are untested (discovery and parsing were exercised against the stand-in only). To verify: set the key, restart the backend, run the headline scenario.
- Not tested on physical phones or with a real on-screen keyboard (only emulation); offline mode was not simulated, only the "backend unreachable / not configured" error paths.
- Retrieval quality has no benchmark; sparse OSM data means many places are matched by category and name only. Semantic noise exists (e.g. an unrelated attraction for "музей истории").
- "Cost" is known for only a handful of places (4 with a `fee` tag), so "free" requests rely on category heuristics and are labelled as unconfirmed.
- Distances are straight lines; the travel time is a labelled rough estimate (no pedestrian router yet).
- Session context is in server memory (lost on backend restart; the client then starts a fresh context under the same id).
- The Gemini model name is discovered at runtime, so a different model may be selected over time; pin it with `GEMINI_MODEL` for reproducibility.
- Single-process rate limiter and session store (fine for a demo, needs Redis for several workers).

## Next: stage 4

Long-term personalization (profile storage, learning from preferences) — not started. Session-only interests (Profile page) and typed `Interest` values are already wired through the API and can be reused.

## Architecture decisions

- **OSM-only data**, Overpass as the access path; no scraping, no photos (no licensed source).
- **Generated `geom` column** so latitude/longitude and the geography can never disagree; `geography` gives metres without projections.
- **Tag rules drive both the Overpass query and classification** (single list, first match wins).
- **Per-category transactions** so a failed category never damages stored data; interrupted runs are closed as `failed` by the next run.
- **Map points endpoint instead of bbox loading**: ~1000 points ≈ 170 kB, loaded once per filter change and clustered client-side by MapLibre. Switch to bbox/vector tiles from the server if the dataset grows by an order of magnitude.
- **OpenFreeMap** for tiles (free, no key, OSM-based, attribution shown); the public OSM tile server is deliberately not used.
- DB image: `pgvector/pgvector:pg16` + PostGIS via apt (the `postgis/postgis` image sits on EOL Debian).
- Tailwind 3, hand-written shadcn-style components; UI strings Russian/Kazakh only (English later).

## Verified (2026-10-18, Docker Desktop on macOS, real Overpass API)

- `docker compose up -d --build` — db, backend, frontend healthy; `alembic upgrade head` → `0002`; also applied cleanly to a fresh empty database.
- Real import from Overpass; the public server answered 502/500 several times and the retry/backoff/fallback logic recovered each time.
- Re-running the importer: run 1 inserted 1030, run 3 (full re-run) inserted **0** and updated 1030; the table still has 1030 rows and 1030 unique `(osm_type, osm_id)`. A run killed midway (run 2) was closed as `failed: interrupted` by the next run.
- API: filters, combined filters, RU/KK names, `Accept-Language`, case-insensitive partial search (Cyrillic, Kazakh), `%`/`_` treated literally, category-name search, nearby with distances (e.g. Baiterek 3.5 m from a point beside it), detail, map GeoJSON, 404, and 422 for bad limit/offset/category/lat/lon/radius/lang/search.
- Browser (in-app): map renders, clusters and colours, category filter, list → detail with fly-to, search, point picking with radius circle, geolocation denied → message and app keeps working, RU↔KK switch without reload (state and map position preserved), language persisted after reload, light/dark switch keeps POI layers, mobile layout at 375 px with bottom sheet, empty-database state on Home and Explore (tested against a separate empty database, since removed).
- `npm run build` (tsc + vite) passes.

## Known issues / not verified

- **Sparse OSM tagging**: only a minority of POIs have `name:kk`, `name:ru`, opening hours, phone or website; the UI shows the original name / "unknown". Small categories (public_space 2, promenade 2, gallery 2, architecture 3) reflect OSM, not a query bug — but the tag rules are first-pass and could be broadened.
- 331 of 1030 POIs are unnamed playgrounds; they dominate the map count in residential areas.
- Objects deleted in OSM are not pruned (see pipeline doc for how to detect them).
- Overpass and OpenFreeMap are public services without an SLA; the importer needs internet access.
- Map labels fall back to the original name where tiles lack `name:kk`/`name:ru`.
- Kazakh UI text was written by hand and has not been reviewed by a native speaker.
- Mobile bottom sheet changes height by tapping the handle (no drag gesture).
- Geolocation success path could not be exercised in the test browser (permission is denied there); only the denied path was tested. The same code sets the origin as manual picking does, which was tested.
- Not tested on a physical phone, Safari or Firefox. No automated tests (by design). `npm audit` not reviewed.
- The importer is not scheduled; refresh is manual.


## External dependencies

- Docker images: `pgvector/pgvector:pg16`, `python:3.12-slim`, `node:22-alpine`, `nginx:1.27-alpine`; apt `postgresql-16-postgis-3`.
- Overpass API (`overpass-api.de`, fallback `overpass.private.coffee`), OpenFreeMap (`tiles.openfreemap.org`), Google Fonts (Inter).
- Python: FastAPI, SQLAlchemy 2, GeoAlchemy2, Alembic, Shapely, httpx, Pydantic 2. JS: React 18, MapLibre GL 4, i18next 24, react-i18next 15, zustand, Tailwind 3.
