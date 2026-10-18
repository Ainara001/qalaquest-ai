# QalaQuest AI

**Discover Astana Your Way** — a personal AI companion for walking around Astana.
Built for the *Build with AI* hackathon (case: NIC Smart City).

> Status: **Stage 7 of 7 (in progress)** — intent chips, opening hours, honest accessibility, real Gemini verified,
> jury documents: [scenarios](docs/HACKATHON_USER_SCENARIOS.md), [RAG for jury](docs/RAG_EXPLAINED_FOR_JURY.md),
> [privacy & verification](docs/PRIVACY_ETHICS_AND_VERIFICATION.md), [limitations](docs/KNOWN_LIMITATIONS.md),
> [pitch](docs/PITCH_5_7_MIN.md), [video guide](docs/VIDEO_CAPTURE_GUIDE.md). To-do: [STAGE7_TODO_AND_CRITERIA.md](docs/STAGE7_TODO_AND_CRITERIA.md).
>
> Previously: **Stage 6 of 7** — map-first redesign, mood-aware map, AI Quest, Group Harmony, Surprise Me
> (on top of stage 5: Living Route + Astana Weather Mode). See [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md);
> the stage 6 audit, plan and file-by-file change log are in [docs/STAGE6_AUDIT_AND_PLAN.md](docs/STAGE6_AUDIT_AND_PLAN.md)
> and [docs/STAGE6_CHANGELOG.md](docs/STAGE6_CHANGELOG.md).

## Stack

| Layer    | Technology |
|----------|------------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS 3, shadcn/ui-style components, Lucide, MapLibre GL JS, i18next |
| Backend  | Python 3.12, FastAPI, SQLAlchemy 2, GeoAlchemy2, Pydantic 2, Alembic, Shapely, httpx |
| Database | PostgreSQL 16 + PostGIS 3 + pgvector |
| AI       | `intfloat/multilingual-e5-large` embeddings (fastembed / ONNX, local), Gemini via `google-genai` |
| Infra    | Docker Compose |

## Requirements

- Docker with Docker Compose v2 (needed to run the stack)
- Node.js 20+ (only for running the frontend outside Docker)
- Python 3.12+ (only for running the backend outside Docker)

## Quick start

```bash
cp .env.example .env        # then set POSTGRES_PASSWORD
./routing/prepare.sh        # once: downloads the OSM extract for the pedestrian router (~225 MB, resumable)
docker compose up -d --build
```

The first start of `valhalla` builds routing tiles (~10 minutes, ~320 MB in `routing/data/`); `GET /api/routes/status` shows when it is ready. Everything else works while it builds; routes fall back to clearly-labelled straight-line estimates.

The first build downloads base images and may take a few minutes.
Migrations are applied automatically when the backend container starts.

| Service  | URL |
|----------|-----|
| Frontend | http://localhost:5173 |
| Backend  | http://localhost:8000 |
| Swagger  | http://localhost:8000/api/docs |
| Health   | http://localhost:8000/api/health |
| Postgres | localhost:5432 |
| Valhalla | http://localhost:8002 |

## Configuration

All settings come from environment variables (see [.env.example](.env.example)).
`.env` is git-ignored — never commit it.

| Variable | Purpose |
|----------|---------|
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT` | Database credentials and host port |
| `BACKEND_PORT`, `FRONTEND_PORT` | Host ports |
| `CORS_ORIGINS` | Comma-separated origins allowed to call the API |
| `VITE_API_URL` | Backend URL as seen from the browser. **Baked in at frontend build time** — rebuild the frontend after changing it |
| `APP_ENV`, `LOG_LEVEL` | Runtime mode and log level |
| `GEMINI_API_KEY` | Enables AI recommendations (https://aistudio.google.com/apikey). Without it search works, AI answers return a clear "not configured" error |
| `GEMINI_MODEL` | Recommended `gemini-flash-latest` (`gemini-2.5-flash` is closed for new keys). Empty = newest `gemini-*-flash` is picked automatically |
| `OVERPASS_URLS` | Optional, comma-separated Overpass endpoints (defaults to public instances, tried in turn on failure) |
| `OVERPASS_USER_AGENT` | Optional User-Agent for Overpass requests; set it to something that identifies you |

## Data: real POIs of Astana

Places come from **OpenStreetMap** via the **Overpass API** — nothing is fabricated or mocked.
After the first `docker compose up` the database is empty; load the data once:

```bash
docker compose exec backend python -m app.scripts.import_pois
```

It takes several minutes (one polite request per category, 3 s apart, with retry and backoff).
Options: `-c museum -c park` (only these categories), `--dry-run` (fetch and classify, write nothing), `--pause 5`.

- Safe to re-run: records are keyed by `(osm_type, osm_id)` and updated in place — no duplicates.
- Each category is written in its own transaction, so a partial failure never corrupts the database.
- To refresh data, run the same command again (for example weekly via cron). Details: [docs/POI_DATA_PIPELINE.md](docs/POI_DATA_PIPELINE.md).
- Map tiles: [OpenFreeMap](https://openfreemap.org) (OSM-based vector tiles, no key). Attribution is shown on the map.
- Data licence: © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright). Keep the attribution when you reuse the data.

## API

Interactive docs: http://localhost:8000/api/docs. All list endpoints accept `lang=ru|kk` (or an `Accept-Language` header; default `ru`).

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | DB, PostGIS and pgvector status |
| `GET /api/pois` | List with `category` (repeat or comma-separate), `search`, `latitude`, `longitude`, `radius` (metres), `limit` (≤100), `offset` |
| `GET /api/pois/nearby` | Required `latitude`, `longitude`; `radius` in metres (default 1000, max 50000); nearest first |
| `GET /api/pois/{id}` | Details; optional `latitude`/`longitude` adds the distance |
| `GET /api/pois/categories` | Categories with counts |
| `GET /api/pois/stats` | Totals, per-category counts, last successful update, sources |
| `GET /api/pois/map` | Compact GeoJSON of all matching POIs (same filters, up to 10 000) |
| `GET /api/pois/suggest` | Search box: `q` (name, any language, typos tolerated), optional `latitude`/`longitude`, `limit` ≤ 20 — ranked exact → prefix → substring → trigram-similar names + matching categories; never calls the LLM |

`distance_m` is the **straight-line geodesic distance on the WGS84 spheroid** (PostGIS `ST_Distance` on `geography`), reported with `distance_method`. It is not a walking route.
Importer control is CLI-only; there is no HTTP endpoint that can change data.

## AI guide (RAG)

1. Put your key into `.env` (`GEMINI_API_KEY=...`) and recreate the backend: `docker compose up -d backend`.
2. Build the vector index once (downloads the ~2.2 GB embedding model into a Docker volume; ~10 min on CPU for 1030 places):

```bash
docker compose exec backend python -m app.scripts.index_pois
```

Re-run it after every POI import (or import with `--index`); unchanged places are skipped.

3. Type a request into the search field on the map (or open the **AI guide** tab) and write, for example: *"Я возле MEGA Silk Way. У меня 60 минут, люблю красивые места и хочу погулять бесплатно"*.

| Endpoint | Description |
|----------|-------------|
| `POST /api/ai/search` | Retrieval only (no LLM): ranked real POIs with score breakdown |
| `POST /api/ai/recommend` | One-shot recommendations (1–3 cards with reasons) |
| `POST /api/ai/chat` | Same with in-session context (`session_id`); `DELETE /api/ai/chat/{session_id}` forgets it |
| `POST /api/ai/surprise` | Surprise me: one relevant real place that is new for this user (stage 6) |
| `POST /api/ai/quests/generate` | AI Quest: 2–5 tasks around real POIs on a real walking route (stage 6) |
| `POST /api/ai/groups/recommend` | Group Harmony: one walk for 2–5 people with an explained compromise (stage 6) |
| `GET /api/events` | Real dated events from verified sources (`when`, `category`, location); `sources_connected = 0` → none shown (stage 7). Import: `python -m app.scripts.import_events`, sources in `EVENT_SOURCES` |

`/api/ai/search`, `/recommend` and `/chat` accept `use_weather=true` (stage 6): the Open-Meteo assessment of the start point is added to the ranking and every card says whether the mood, the weather or the user's interests put it there (`explanation.mood`, `explanation.weather_fit`, `matched_interests[].source`).
| `GET /api/ai/status` | LLM configured? model, embedding readiness, indexed POI count |

Details: [docs/RAG_ARCHITECTURE.md](docs/RAG_ARCHITECTURE.md). Mobile UI: [docs/MOBILE_UI.md](docs/MOBILE_UI.md).
Limits: 12 AI requests / minute / IP (`AI_RATE_LIMIT_PER_MIN`), messages ≤ 1000 characters. Distances are straight-line, never presented as walking routes.

## Personalization (guest profile)

- **Profile** tab: interests (16), walking habits (duration, max distance, pace, indoor/outdoor, number of places), budget, accessibility, favourite / avoided categories, saved / visited / hidden places, privacy controls. **Home**: mood of the day and "places you may like". **AI guide**: switch "Use my preferences", mood chip, feedback on every card and "Why is this recommended to me?".
- Stored only in this browser and only after the user allows it; sent with AI requests and validated by the backend (`personalization` field of `/api/ai/search | recommend | chat`; unknown fields → 422).
- Ranking weights: `backend/app/core/ranking.py`, optional override `RANKING_WEIGHTS='{"interest":0.3}'`.
- Details: [docs/PERSONALIZATION_ARCHITECTURE.md](docs/PERSONALIZATION_ARCHITECTURE.md).

## Living Route and weather

- On the map (stage 6; `/walk` redirects there): **Route** on a place card, **Build a walk** from "Places for you", **Start a walk with these places** in an AI answer, or a group walk. Plan 1–3 places for a time budget, start, then mark places as visited, skip, or change the route (time left, less walking, go indoors, interests, another place, free text to AI, update location / weather). Each change calls the backend and is shown as a **proposal** (what changes and why, drawn on the map); the walk changes only after **Apply**.
- API: `POST /api/routes/plan`, `POST /api/routes/replan`, `GET /api/routes/status`, `GET /api/weather/current`, `GET /api/weather/forecast`.
- External services: Valhalla (self-hosted), Open-Meteo (no key), OpenFreeMap tiles, Gemini (optional, only for free-text changes and summaries).
- Details: [docs/LIVING_ROUTE_ARCHITECTURE.md](docs/LIVING_ROUTE_ARCHITECTURE.md), [docs/WEATHER_INTEGRATION.md](docs/WEATHER_INTEGRATION.md).

## Stage 6: map first, mood, quests, groups, surprise

- **Map = main screen**, three tabs (Map, AI guide, Profile). Search field "Find a place or ask the AI…": place names go to `/api/pois/suggest` (no AI), requests in words go to the AI guide. Quick filters with values (mood, near, time, budget, categories, filters). Details: [docs/MAP_FIRST_UX.md](docs/MAP_FIRST_UX.md).
- **Mood-aware map**: 9 moods in one tap; the "Places for you" layer (`/api/ai/search`, no LLM) re-ranks real POIs for mood + weather + profile + time + budget and explains each place by source. The same context is used by the AI guide and Living Route.
- **Surprise Me, AI Quest, Group Harmony**: quick actions on the map. Algorithms and limits: [docs/ADVANCED_AI_FEATURES.md](docs/ADVANCED_AI_FEATURES.md).
- Unit tests of the new algorithms (no database needed): `cd backend && pip install -r requirements-dev.txt && pytest`.

## Localisation (RU / KK)

- UI: `i18next` with `frontend/src/i18n/locales/ru.json` and `kk.json`. Russian is the default; the choice is stored in `localStorage` (`qq-lang`) and switching does not reload the page or reset the map.
- POI names: `name:ru` / `name:kk` from OSM are used when present, otherwise the original `name`. Names and descriptions are never machine-translated.
- Map labels use `name:kk` / `name:ru` where the tile data has them.
- To add a language later: add a locale file, register it in `i18n/index.ts` and `LANGUAGES`; the API already stores `name_en` / `description_*`.

## Common commands

```bash
docker compose up -d --build     # start / rebuild everything
docker compose ps                # service state and health
docker compose logs -f backend   # JSON logs of the API
docker compose down              # stop (data is kept)
docker compose down -v           # stop and DELETE the database volume
```

## Migrations (Alembic)

Run inside the backend container:

```bash
docker compose exec backend alembic upgrade head                      # apply
docker compose exec backend alembic current                           # show version
docker compose exec backend alembic revision --autogenerate -m "msg"  # new migration
docker compose exec backend alembic downgrade -1                      # roll back one
```

New migration files are created inside the container; copy them out or mount `backend/` if you generate them often.
Migrations: `0001` enables `postgis` and `vector`; `0002` adds `pois` and `import_runs` (and `pg_trgm`); `0003` adds `poi_index` (documents, 1024-d embeddings, full-text vectors).

## Local development without Docker for the app

Start only the database (`docker compose up -d db`), then:

```bash
# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL=postgresql+psycopg://qalaquest:<password>@localhost:5432/qalaquest
alembic upgrade head
uvicorn app.main:app --reload

# frontend (separate terminal)
cd frontend
npm install
npm run dev        # http://localhost:5173
```

## Project layout

```
backend/    FastAPI app (api, core, db, models, schemas, services, rag, integrations) + Alembic
frontend/   React app (components, pages, layouts, hooks, services, stores, styles)
db/         Dockerfile for PostgreSQL + PostGIS + pgvector
docs/       PROJECT_STATUS.md, POI_DATA_PIPELINE.md, RAG_ARCHITECTURE.md, MOBILE_UI.md, PERSONALIZATION_ARCHITECTURE.md,
            LIVING_ROUTE_ARCHITECTURE.md, WEATHER_INTEGRATION.md, MAP_FIRST_UX.md, ADVANCED_AI_FEATURES.md,
            STAGE6_AUDIT_AND_PLAN.md, STAGE6_CHANGELOG.md
backend/tests/  unit tests of the stage 6 algorithms (pytest, no database)
routing/    prepare.sh (OSM extract download); data/ is git-ignored
```
