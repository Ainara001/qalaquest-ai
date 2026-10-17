# QalaQuest AI

**Discover Astana Your Way** — a personal AI companion for walking around Astana.
Built for the *Build with AI* hackathon (case: NIC Smart City).

> Status: **Stage 2 of 7** — real Astana POIs, interactive map, RU/KK interface.
> See [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md).

## Stack

| Layer    | Technology |
|----------|------------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS 3, shadcn/ui-style components, Lucide, MapLibre GL JS, i18next |
| Backend  | Python 3.12, FastAPI, SQLAlchemy 2, GeoAlchemy2, Pydantic 2, Alembic, Shapely, httpx |
| Database | PostgreSQL 16 + PostGIS 3 + pgvector |
| Infra    | Docker Compose |

## Requirements

- Docker with Docker Compose v2 (needed to run the stack)
- Node.js 20+ (only for running the frontend outside Docker)
- Python 3.12+ (only for running the backend outside Docker)

## Quick start

```bash
cp .env.example .env        # then set POSTGRES_PASSWORD
docker compose up -d --build
```

The first build downloads base images and may take a few minutes.
Migrations are applied automatically when the backend container starts.

| Service  | URL |
|----------|-----|
| Frontend | http://localhost:5173 |
| Backend  | http://localhost:8000 |
| Swagger  | http://localhost:8000/api/docs |
| Health   | http://localhost:8000/api/health |
| Postgres | localhost:5432 |

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

`distance_m` is the **straight-line geodesic distance on the WGS84 spheroid** (PostGIS `ST_Distance` on `geography`), reported with `distance_method`. It is not a walking route.
Importer control is CLI-only; there is no HTTP endpoint that can change data.

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
Migration `0001` enables the `postgis` and `vector` extensions; `0002` adds `pois` and `import_runs` (and `pg_trgm` for name search).

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
docs/       PROJECT_STATUS.md, POI_DATA_PIPELINE.md
```
