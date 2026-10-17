# QalaQuest AI

**Discover Astana Your Way** — a personal AI companion for walking around Astana.
Built for the *Build with AI* hackathon (case: NIC Smart City).

> Status: **Stage 1 of 7** — infrastructure, backend skeleton and UI shell.
> See [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md).

## Stack

| Layer    | Technology |
|----------|------------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS 3, shadcn/ui-style components, Lucide |
| Backend  | Python 3.12, FastAPI, SQLAlchemy 2, Pydantic 2, Alembic |
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
Migration `0001` enables the `postgis` and `vector` extensions.

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
docs/       PROJECT_STATUS.md
```
