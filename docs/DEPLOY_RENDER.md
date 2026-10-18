# Деплой на Render (демо для жюри)

**Сайт:** https://qalaquest-web.onrender.com · **API:** https://qalaquest-api.onrender.com/api/docs
Ветка деплоя: `stage7/03-render-deploy` (автодеплой при пуше). Регион Frankfurt, бесплатные тарифы.

| Сервис | Тип | Что внутри |
|---|---|---|
| `qalaquest-db` | Render PostgreSQL 16 (free) | PostGIS 3.6, pgvector 0.8, pg_trgm |
| `qalaquest-api` | Web Service, Docker (`backend/Dockerfile`) | FastAPI; при старте `alembic upgrade head` |
| `qalaquest-web` | Web Service, Docker (`frontend/Dockerfile`) | nginx + сборка Vite (SPA-переходы работают) |

## Чем отличается от локального стека
- **Поиск без векторов (лексический режим, `EMBEDDING_MODEL=none`).** Локальная модель эмбеддингов не помещается в 512 МБ: MiniLM занимает ~594 МБ после загрузки, процесс падал. Gemini-эмбеддинги (`gemini-embedding-001`, поддерживаются кодом) на бесплатном ключе ограничены 1000 текстами в сутки, а это меньше, чем 1177 мест. Поэтому индекс хранит документы и полнотекстовые векторы без эмбеддингов (миграция `0006`), а поиск идёт по ключевым словам, названиям, категориям, которые Gemini извлекает из запроса, и по ранжированию (расстояние, время, интересы, погода, часы работы). Локальный стек (`docker compose`) работает в полном гибридном режиме с e5-large. Режим виден в `GET /api/ai/status` → `retrieval_mode`.
- **Генерация:** `GEMINI_MODEL=gemini-flash-lite-latest`, резерв `GEMINI_FALLBACK_MODELS=gemini-flash-latest`. У flash на бесплатном ключе 20 запросов в сутки; при 429 или 404 запрос автоматически уходит к следующей модели.
- **Данные:** Overpass с серверов Render почти всегда отвечает 500/504, поэтому в репозитории лежит снимок ответов Overpass `backend/data/osm_snapshot.json.gz` (1030 POI, © OpenStreetMap contributors, ODbL). При `AUTO_BOOTSTRAP_DATA=true` сервер один раз импортирует снимок тем же конвейером и строит индекс в фоне (~10–20 мин на бесплатном CPU).
- **Пешеходные маршруты:** Valhalla не развёрнута (нужны тайлы всего Казахстана). Время и расстояние — честно помеченные оценки по прямой.
- **Сон:** бесплатные сервисы засыпают после 15 мин без запросов; первое открытие ≈ 1 мин. Перед показом откройте сайт заранее.
- **Срок:** бесплатная база Render удаляется 17.11.2026.

## Переменные `qalaquest-api`
`DATABASE_URL` (Internal URL базы, `postgresql://` принимается), `CORS_ORIGINS=https://qalaquest-web.onrender.com`, `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-flash-lite-latest`, `GEMINI_FALLBACK_MODELS=gemini-flash-latest`, `EMBEDDING_MODEL=none`, `EMBEDDING_DIM=768`, `AUTO_BOOTSTRAP_DATA=true`, `OVERPASS_URLS`.
`qalaquest-web`: `VITE_API_URL=https://qalaquest-api.onrender.com` (передаётся в сборку как build-arg).

## Обновить снимок данных
```bash
cd backend
python -m app.scripts.import_pois --dry-run --record data/osm_snapshot.json.gz   # локально, где Overpass доступен
git add data/osm_snapshot.json.gz && git commit -m "OSM snapshot" && git push   # сервер импортирует новый снимок один раз
```
