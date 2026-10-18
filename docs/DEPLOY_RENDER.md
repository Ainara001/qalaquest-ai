# Деплой на Render (демо для жюри)

**Сайт:** https://qalaquest-web.onrender.com · **API:** https://qalaquest-api.onrender.com/api/docs
Ветка деплоя: `stage7/03-render-deploy` (автодеплой при пуше). Регион Frankfurt, бесплатные тарифы.

| Сервис | Тип | Что внутри |
|---|---|---|
| `qalaquest-db` | Render PostgreSQL 16 (free) | PostGIS 3.6, pgvector 0.8, pg_trgm |
| `qalaquest-api` | Web Service, Docker (`backend/Dockerfile`) | FastAPI; при старте `alembic upgrade head` |
| `qalaquest-web` | Web Service, Docker (`frontend/Dockerfile`) | nginx + сборка Vite (SPA-переходы работают) |

## Чем отличается от локального стека
- **Модель эмбеддингов:** `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` (384-d, 0,22 ГБ) вместо `multilingual-e5-large` (1024-d, 2,2 ГБ) — бесплатный тариф даёт 512 МБ памяти. Миграция `0005` подгоняет размер вектора под `EMBEDDING_DIM`. Качество семантического поиска немного ниже; гибридный поиск (полнотекст + названия) не меняется.
- **Данные:** Overpass с серверов Render почти всегда отвечает 500/504, поэтому в репозитории лежит снимок ответов Overpass `backend/data/osm_snapshot.json.gz` (1030 POI, © OpenStreetMap contributors, ODbL). При `AUTO_BOOTSTRAP_DATA=true` сервер один раз импортирует снимок тем же конвейером и строит индекс в фоне (~10–20 мин на бесплатном CPU).
- **Пешеходные маршруты:** Valhalla не развёрнута (нужны тайлы всего Казахстана). Время и расстояние — честно помеченные оценки по прямой.
- **Сон:** бесплатные сервисы засыпают после 15 мин без запросов; первое открытие ≈ 1 мин. Перед показом откройте сайт заранее.
- **Срок:** бесплатная база Render удаляется 17.11.2026.

## Переменные `qalaquest-api`
`DATABASE_URL` (Internal URL базы, `postgresql://` принимается), `CORS_ORIGINS=https://qalaquest-web.onrender.com`, `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-flash-latest`, `EMBEDDING_MODEL`, `EMBEDDING_DIM=384`, `PRELOAD_EMBEDDING_MODEL` (модель запекается в образ), `AUTO_BOOTSTRAP_DATA=true`, `OVERPASS_URLS`.
`qalaquest-web`: `VITE_API_URL=https://qalaquest-api.onrender.com` (передаётся в сборку как build-arg).

## Обновить снимок данных
```bash
cd backend
python -m app.scripts.import_pois --dry-run --record data/osm_snapshot.json.gz   # локально, где Overpass доступен
git add data/osm_snapshot.json.gz && git commit -m "OSM snapshot" && git push   # сервер импортирует новый снимок один раз
```
