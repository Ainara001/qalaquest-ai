# QalaQuest AI — Project status

_Last updated: 2026-10-18 (stage 6)_

## Stages

| # | Stage | State |
|---|-------|-------|
| 1 | Architecture, infrastructure, UI shell | **Done** |
| 2 | Real POIs of Astana, interactive map, RU/KK UI | **Done** (see "Known issues") |
| 3 | RAG + AI, mobile-first light UI | **Done except one item**: real Gemini calls were not verified (no API key available) |
| 4 | Personal AI: profile, moods, feedback, personal ranking | **Done**; real Gemini still unverified (no key) |
| 5 | Living Route (real pedestrian routing, re-planning) + Astana Weather Mode | **Done**; Gemini-dependent parts (free-text route changes, route summaries) unverified with the real API (no key) |
| 6 | Map-first UX, Mood-Aware Map, AI Quest, Group Harmony, Surprise Me | **Implemented** in branches `stage6/01…12` (not merged into `main`; the last one contains everything); verified with unit tests and in the browser against a scratch API that runs the real services on synthetic rows — **not yet run against the real database, Valhalla or Gemini** (see "Stage 6") |
| 7 | English UI, presentation | Not started |

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

### Stage 4 — actual results

**Audit before work:** stages 1–3 intact, git clean, no `GEMINI_API_KEY` configured (unchanged), 1030 POIs indexed. No critical RAG defects found; one ranking detail was reworked (keyword rank folded into the semantic score).

**Implemented**
- Backend: `schemas/personalization.py` (`UserPreferences`, `SessionPreferences`, `FeedbackSummary`, `PersonalizationInput`, strict validation), `services/personalization.py` (`PersonalizationService`: priority merge, taste vector, transparent feedback model), rewritten `rag/retrieval.py` (8 explainable scores, configurable weights in `core/ranking.py`, multipliers, relevance floor, diversity), `Explanation` / `PersonalizationInfo` in responses, profile-aware LLM prompt (`why` per candidate, `USER_PROFILE`, `MAX_PICKS`), `ignore_preferences` in query understanding, strict-free logic with an explicit "show unconfirmed" path, `/api/ai/search` reused for personal home picks (own 60/min limit, no LLM), dedupe keys over the full request.
- Frontend: `stores/profile.ts` (guest profile, opt-in `localStorage`, session mood, feedback with mutually exclusive actions), new Profile page, Home mood row + "places you may like" / setup card, Guide personalization switch + mood chip, feedback chips + bottom sheet, "Why is this recommended to me?" panel, notices for no confirmed free / no accessible places. RU/KK for everything new (key sets identical).
- Docs: [PERSONALIZATION_ARCHITECTURE.md](PERSONALIZATION_ARCHITECTURE.md), README, MOBILE_UI.

**Verified**
- Scenarios A–F on real POIs through `/api/ai/search` (deterministic ranking): A and B differ (2 of 5 overlap) and both differ from the baseline; C museums excluded only when asked; D "never" honoured (also with personalization off); E switch off = baseline; F Kazakh names and labels. Feedback learning is gradual (1 like → 0.57, 3 more-like → 0.93 feedback score). Strict free, unconfirmed free, budget, wheelchair, pace + max distance + family, mood.
- Chat path (understanding → personal retrieval → generation → validation) for C via text, "something completely different" (`profile_ignored`), E, F (Kazakh answer), `places_count=1`, strict free — against the local Gemini stand-in.
- Validation: unknown fields (client weights), unknown interests, bad budget, non-integer ids, `places_count` > 3 → 422; valid payload → 200.
- UI (in-app browser, 375 px and 320 px): profile edit, opt-in saving, persistence after reload, RU → KK keeps the profile, personal home picks with reasons, chat cards with the why panel in Kazakh, "never" from the bottom sheet removes the place from the next answer, no horizontal overflow on Home / Map / Guide / Profile at 320 px; frontend production build passes.

**Not verified / known issues**
- Real Gemini answers (personal reasons in natural language) — no API key; only the stand-in was used.
- Physical phones / real keyboards not tested (emulation only).
- Price and accessibility data are sparse, so those filters can return very little (reported to the user).
- Heuristic affinities and tag rules have no offline evaluation; the feedback model is a simple transparent rule, not learned.
- Profile is per device (no sync); the server keeps no profile.

### Stage 5 — plan (written first) and actual results

**Plan:** self-hosted Valhalla (pedestrian costing) from the OSM Kazakhstan extract; `RoutePlanningService` (matrix + exhaustive ordering of ≤3 stops with hard time/distance/weather constraints, real geometry); client-held `RouteSession` + stateless `LivingRouteService.replan` with honest diffs; `WeatherService` on Open-Meteo with configurable comfort rules feeding both ranking and routing; `/walk` screen with a three-state bottom sheet, active-walk bar, RU/KK; docs.

**Audit:** stages 1–4 intact, git clean, still no `GEMINI_API_KEY`. No blocking defects. Found during the stage: candidate retrieval for routes allowed half visits (fixed with `full_visit_fit`), the search radius for short remaining times was too small (route reach = half of the remaining time), and the outdoor limit was mislabelled as weather when it came from "go indoors" (now `indoor_cap_applied`, removed reason `outdoor_limit`).

**Implemented**
- Infra: `valhalla` service in Compose (tiles in `routing/data/`, git-ignored), `routing/prepare.sh` (resumable download — the in-container download had failed at 31 %).
- Backend: `integrations/valhalla.py`, `services/route_planning.py`, `services/living_route.py`, `services/weather.py`, `core/weather_rules.py`, `schemas/routes.py`, `schemas/weather.py`, `api/routes.py` (`/api/routes/plan|replan|status`, `/api/weather/current|forecast`); `weather` ranking score; route-specific intent flags (`less_walking`, `go_indoor`, `finish_now`). `/api/routes/optimize` was not added: ordering is part of `plan`/`replan`.
- Frontend: `pages/Walk.tsx`, `components/walk/*`, `components/WeatherCard.tsx`, `stores/walk.ts`, `services/routes.ts`, route line in `MapView`, entry points (Home card, AI guide answer, map card), active-walk bar, RU/KK strings (identical key sets).
- Docs: [LIVING_ROUTE_ARCHITECTURE.md](LIVING_ROUTE_ARCHITECTURE.md), [WEATHER_INTEGRATION.md](WEATHER_INTEGRATION.md), README, MOBILE_UI.

**Verified (real Valhalla, real POIs, real Open-Meteo)**
- Pedestrian vs car vs straight line for the same pair (2.47 km / 31 min vs 3.2 km vs 1.93 km).
- Plans: 1 POI (refused when 93 min > 90 budget), 3 POIs in 90 min (21 min walking + ≈60 visits + 3 buffer = 84, shortest of 336 orders), profile architecture+photo at slow pace (3.6 km/h), parks profile, out-of-area 422.
- Re-planning: visited (restart from that place, 84 → 74 min), 25 min left (honest no-candidates: nothing short enough within reach), less walking (74 → 46 min, 1.6 → 0.7 km), go indoor (library/gallery, outdoor ≈7 min, correct attribution), new position near Mega Silk Way (stops replaced), interests → coffee (café added), 5 min left, stale session 409, free text without key 503.
- Weather: real Astana data (UTC+5), comfortable today; with a lowered configured wind threshold the same 90-min plan dropped to ≈22 outdoor minutes with an indoor gallery.
- Engine down → straight-line mode, no line drawn. Route summary guard drops LLM text with numbers not in the facts (stand-in).
- UI (375 px, in-app browser): plan in Kazakh with the saved profile ("never" place excluded), real line and numbered stops on the map, start walk, "I visited", change sheet, go indoor, active-walk bar on the map tab, RU switch + reload keep the walk, geolocation denied and AI-unavailable messages; production build passes.

**Not verified / known issues**
- Real Gemini for free-text route changes and summaries (no key). Quick actions cover the same changes without AI.
- Physical phones, real GPS movement and on-screen keyboards not tested.
- Stop names keep the language in which the route was computed until the next re-plan.
- Visit durations are category estimates; opening hours exist for few places, so "open at arrival" cannot be checked.
- Sparse short-visit POIs near some points make short walks infeasible (reported honestly).
- Routing data is a snapshot of the OSM extract; refresh by re-running `prepare.sh` and deleting `routing/data/valhalla_tiles*`.

## Stage 6 — plan and actual results

**Audit before work** ([STAGE6_AUDIT_AND_PLAN.md](STAGE6_AUDIT_AND_PLAN.md)): stages 1–5 intact, local copy identical to `origin/main`, stage 6 not started. Found: moods not matching the spec, no weather in recommendations, reasons not separated by source, `atmosphere` from the text ignored (except quiet), name search sorted alphabetically, stale walk mood overriding the map, re-plans applied without confirmation, session time beating the time stated in the chat, duplicated "router unavailable" notice, dishonest re-plan reasons, outdated statements in RAG/pipeline docs, no `.gitattributes` (CRLF breaks `prepare.sh` on Windows). All fixed in the phases below. File-by-file log: [STAGE6_CHANGELOG.md](STAGE6_CHANGELOG.md).

**Environment of this stage:** Windows machine **without Docker, PostgreSQL/PostGIS, the POI data, Valhalla or a Gemini key**. Therefore: backend code was checked by imports, SQL compilation for PostgreSQL, unit tests, and a scratch API (outside the repository) that runs the real ranking, card, route-planning, Living Route, Surprise, Quest and Group code on synthetic rows labelled "[тест]"; the UI was checked in the in-app browser against that scratch API.

**Implemented** (branches, each created from the previous one)
1. `stage6/01-audit-fixes` — audit and plan, `.gitattributes`, doc fixes, atmosphere → request interest, type fixes.
2. `stage6/02-recommendation-context` — `RecommendationContext` + shared helpers; stage 6 moods (romantic, learn); `use_weather` in `/api/ai/search|recommend|chat`; `explanation.mood` / `weather_fit`; `GET /api/pois/suggest` (pg_trgm, no LLM).
3. `stage6/03-map-first-ui` — map as the start screen, 3 tabs, unified search with automatic place-name / AI detection, quick filter chips with values, one-tap mood sheet, "Places for you" layer (top 1–3 pins + ring layer, regular POIs faded, toggleable), reasons by source, place card with 3 sheet states and quick route, walk / plan / route preview on the map, shared walk-context store, AI wishes synced into the map, category icons and lighter clusters, RU/KK.
4. `stage6/04-living-route-sync` — re-plans as proposals (Apply / Keep current), current context in every plan/replan, "mood changed — suggest a route?", honest `ranked_lower` / `matched_mood` reasons.
5. `stage6/05-surprise-me` — `SurpriseRecommendationService`, `POST /api/ai/surprise`, card with "show on map" / "another option".
6. `stage6/06-ai-quest` — `QuestGenerationService`, `POST /api/ai/quests/generate`, 6 quest types, 2–5 tasks bound to POI ids on a real route, client-held progress (pending/active/completed/skipped).
7. `stage6/07-group-harmony` — `GroupRecommendationService`, `POST /api/ai/groups/recommend`, per-member normalised fit, least-satisfied objective, explained compromise.
8. `stage6/08-docs-verification` — unit tests (`backend/tests`), weather fail-fast for the map, shared place-detail request, error boundary, MapLibre in its own chunk, docs ([MAP_FIRST_UX.md](MAP_FIRST_UX.md), [ADVANCED_AI_FEATURES.md](ADVANCED_AI_FEATURES.md), README, MOBILE_UI, RAG_ARCHITECTURE, this file).

**Verified (this machine)**
- `npm run build` (tsc + vite) passes; RU/KK key sets identical (811 keys each), no raw keys on screen; `pytest`: 38 passed (algorithms + request validation of the new endpoints).
- Scenario 1 (mood): "Beautiful photos" → architecture / monuments / public spaces; "Calm rest" → parks / promenades / café, reasons by source; with "very cold" weather a romantic mood moves a café and a restaurant up with "because of the weather".
- Scenario 2 (quick search): typing a name → ranked suggestions → place card in one tap → **Route** → route preview with time and distance; a request in words → AI path (without a key: clear `ai_not_configured` message with retry).
- Scenario 3 (AI Quest): photo hunt / city secrets created from candidate POIs, honest notices when few places fit, start → active task → done → next; quest stops and bar on the map.
- Scenario 4 (Group Harmony): the spec's three members (architecture+photo / coffee+calm / museums+history) → algorithm picks architecture + park + monument with everyone covered (unit test); in the UI an honest compromise with the shortest time and an uncovered member named.
- Scenario 5 (Surprise Me): six "another option" taps → six different places of different categories, reasons, estimates, "new for you ≠ little-known".
- Scenario 6 (Living Route): walk started from "Places for you", mood changed on the map → banner and bar hint → proposal with the diff, current walk unchanged → Apply → walk and its mood updated.
- No horizontal overflow at 320, 375, 390, 430 px (map and every new panel); desktop layout at 1280 px; language switch keeps mood, place card, walk, quest and group.

**Not verified / known issues**
- **Nothing in stage 6 has been run against the real PostgreSQL/PostGIS database with the 1030 real POIs, the real e5 embeddings, Valhalla or Gemini.** The new SQL (`/api/pois/suggest`) was compiled for the PostgreSQL dialect but never executed. To verify: `docker compose up -d --build`, import + index POIs (README), open http://localhost:5173 and repeat scenarios 1–6; Swagger shows the new endpoints.
- Real Gemini wording for quests / surprise ideas / chat is unverified (no key); without a key the templates and category ideas are used, labelled as such.
- Physical phones, real GPS and on-screen keyboards not tested (emulation only). In the in-app browser the map canvas does not repaint while the pane is hidden (environment artefact; a forced redraw showed all layers).
- The place-name / AI-request detection is a heuristic; the other option is always offered in the search panel.
- Group fit and Surprise novelty are category- and tag-level calculations (documented), not judgements about specific places; OSM data stays sparse (prices, accessibility, hours).
- Branches are not merged into `main`; `main` was not touched. Later branches: `stage6/09-polish` (P2: peek of the best place, mood hint, "plan a walk" entry), `stage6/10-hardening` (review fixes, API validation tests), `stage6/11-quest-on-map-motion` (active quest flags on the map, gentle motion) and `stage6/12-final-review` (data info in Profile, lint fixes, version 0.6.0). **The newest branch, `stage6/12-final-review`, contains everything.**
- `ghcr.io/valhalla/valhalla-scripted:latest` is still unpinned (reproducibility; not changed because the matching tag could not be checked here).

## Next: stage 7

Not started (by the stage 6 instructions). Before stage 7: merge `stage6/12-final-review` into `main` after a review and run the real-stack verification above.

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
- ~~Mobile bottom sheet changes height by tapping the handle (no drag gesture).~~ Stage 6: the map sheet has three snap states with a drag gesture on the handle.
- Geolocation success path could not be exercised in the test browser (permission is denied there); only the denied path was tested. The same code sets the origin as manual picking does, which was tested.
- Not tested on a physical phone, Safari or Firefox. No automated tests (by design). `npm audit` not reviewed.
- The importer is not scheduled; refresh is manual.


## External dependencies

- Docker images: `pgvector/pgvector:pg16`, `python:3.12-slim`, `node:22-alpine`, `nginx:1.27-alpine`; apt `postgresql-16-postgis-3`.
- Overpass API (`overpass-api.de`, fallback `overpass.private.coffee`), OpenFreeMap (`tiles.openfreemap.org`), Google Fonts (Inter).
- Python: FastAPI, SQLAlchemy 2, GeoAlchemy2, Alembic, Shapely, httpx, Pydantic 2. JS: React 18, MapLibre GL 4, i18next 24, react-i18next 15, zustand, Tailwind 3.
