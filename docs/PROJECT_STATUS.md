# QalaQuest AI — Project status

_Last updated: 2026-10-18_

## Stages

| # | Stage | State |
|---|-------|-------|
| 1 | Architecture, infrastructure, UI shell | **Done** |
| 2 | Real POI collection (OSM etc.) and DB schema | Not started |
| 3–7 | RAG, personalization, Living Route, Quest, Weather, Group Harmony, Surprise Me, i18n | Not started |

## Implemented in stage 1

**Backend** (`backend/`)
- FastAPI app with settings from env (pydantic-settings), CORS, JSON structured logging, request log middleware, unified error format `{"error": {code, message}}`, Swagger at `/api/docs`.
- SQLAlchemy 2 engine/session (`app/db/session.py`), Alembic configured; migration `0001` enables `postgis` and `vector`.
- `GET /api/health` — queries the DB, returns PostgreSQL / PostGIS / pgvector versions; returns **503** with `status: degraded` when the DB or an extension is unavailable.
- Empty packages for later stages: `models`, `services`, `rag`, `integrations`.

**Frontend** (`frontend/`)
- Vite + React + TypeScript + Tailwind 3; shadcn-style `Button`, `Card`, `Badge`; Lucide icons.
- Layout with sticky header, desktop nav, mobile bottom nav, light/dark theme (persisted, follows system by default).
- Home page with a live **System status** card fed by `/api/health`.
- Explore, AI Planner, Living Route, Quest, Profile: pages explicitly marked "under development" (no fake content).
- API client `src/services/api.ts`, `useHealth` hook, zustand theme store.

**Infrastructure**
- `docker-compose.yml`: `db` (healthcheck) → `backend` (healthcheck, runs `alembic upgrade head` then uvicorn) → `frontend` (nginx serving the Vite build).
- `db/Dockerfile`: `pgvector/pgvector:pg16` + `postgresql-16-postgis-3`.

## Architecture decisions

- **DB image**: built on `pgvector/pgvector:pg16` and PostGIS installed via apt, because the `postgis/postgis` image is on Debian bullseye whose PGDG repo is gone.
- **Migrations run on backend start** (simple for a hackathon; move to a separate job if multiple replicas are ever needed).
- **Tailwind 3** (not 4) for stable shadcn/ui compatibility. shadcn components are written by hand in `components/ui`; `components.json` is present so `npx shadcn add` works.
- **`VITE_API_URL` is a build-time arg** — frontend is a static build behind nginx.
- UI strings are English for now; i18n (RU/KK/EN) comes later.
- No `geoalchemy2` / `pgvector` Python packages yet — added in stage 2 together with the first tables.

## Verified (2026-10-18, Docker Desktop on macOS)

- `docker compose up -d --build`: db, backend, frontend all start; healthchecks pass.
- `alembic upgrade head` applied (`0001`); re-running is a no-op.
- PostGIS 3.6.4 and pgvector 0.8.7 present; real queries run (`ST_MakePoint`, `vector <->`).
- `/api/health` → 200 with versions; with the db stopped → 503 `degraded`; recovers after restart.
- Swagger 200, unknown route → JSON error, CORS header for `http://localhost:5173`.
- `npm run build` passes (tsc + vite). In the browser: no console errors, System status card shows live data, theme toggle works, mobile layout (375px) checked.

## Known issues / not verified

- No automated tests (by design for this stage).
- Frontend not checked on a real phone or in Safari/Firefox; only the in-app browser.
- Inter font is loaded from Google Fonts (needs internet; falls back to system font).
- `npm audit` was not reviewed.
- Alembic autogenerate has no models yet — untested.

## Next: stage 2

Real POI collection for Astana (OpenStreetMap/Overpass or similar), `poi` table with PostGIS geometry, deduplication, source attribution, embeddings column for pgvector.

## External dependencies

- Docker images: `pgvector/pgvector:pg16`, `python:3.12-slim`, `node:22-alpine`, `nginx:1.27-alpine`; apt packages `postgresql-16-postgis-3`.
- Google Fonts (Inter) at runtime.
- Future: OpenStreetMap/Overpass, a weather API, an LLM provider (not integrated yet).
