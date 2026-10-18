# Журнал изменений файлов — этап 6

Каждая фаза — отдельная ветка, созданная от предыдущей (`main` не изменяется). Действия: **create** — файл создан, **edit** — изменён, **delete** — удалён. Сгенерированные файлы (`node_modules/`, `dist/`) не учитываются.

## Фаза 1 — `stage6/01-audit-fixes`

| Действие | Файл | Что сделано |
|---|---|---|
| create | `docs/STAGE6_AUDIT_AND_PLAN.md` | Аудит: текущий этап, найденные проблемы (B1–B10, F1–F9, D1–D5), план из 8 фаз |
| create | `docs/STAGE6_CHANGELOG.md` | Этот журнал |
| create | `.gitattributes` | LF для всех текстовых файлов и `*.sh` — `routing/prepare.sh` больше не ломается на Windows (D4) |
| edit | `docs/RAG_ARCHITECTURE.md` | Помечена устаревшая таблица весов этапа 3, исправлено «маршрутизатора ещё нет» (D1) |
| edit | `docs/POI_DATA_PIPELINE.md` | Уточнено, где расстояния по прямой, а где пешеходный маршрут (D2) |
| edit | `backend/app/services/personalization.py` | `atmosphere` из запроса (`quiet`, `romantic`, `family`) теперь влияет на ранжирование как интерес запроса (B4) |
| edit | `frontend/src/services/ai.ts` | Типы: `weather` в `scores`, интересы этапа 4 в `Interest` (F8) |
| edit | `frontend/index.html` | `lang="ru"` до загрузки JS (F9) |

## Фаза 2 — `stage6/02-recommendation-context`

| Действие | Файл | Что сделано |
|---|---|---|
| create | `backend/app/schemas/context.py` | `RecommendationContext` — общий входной контекст для карты, Surprise Me, квестов (таблица соответствия полям ТЗ §11) (B8) |
| create | `backend/app/services/context.py` | Общие шаги: стартовая точка (с уведомлением о центре города), оценка погоды, сборка `PersonalContext` |
| edit | `backend/app/rag/taxonomy.py` | Настроения этапа 6: `romantic`, `learn`, новый список `MAP_MOODS`; старые `inspiration`/`quiet` оставлены для совместимости (B1) |
| edit | `backend/app/rag/retrieval.py` | `Candidate.weather_fit` — помечает, что место поднято из-за погоды (B3) |
| edit | `backend/app/schemas/ai.py` | `use_weather` и `exclude_poi_ids` в `SearchRequest`, `use_weather` в `AiRequest`, `weather` в ответах, `explanation.mood` / `explanation.weather_fit` (B2, B3) |
| edit | `backend/app/services/recommendation.py` | Погода в `/search`, `/recommend`, `/chat`; правила промпта: настроение ≠ свойство места, `weather_fit`, строка `WEATHER` (B2, B3) |
| edit | `backend/app/services/living_route.py` | Оценка погоды через общий `assess_weather` (без дублирования) |
| edit | `backend/app/api/ai.py` | `RecommendationService` получает `WeatherService` |
| edit | `backend/app/schemas/poi.py` | `SuggestItem`, `SuggestResponse` |
| edit | `backend/app/api/pois.py` | `GET /api/pois/suggest` — поиск по названию с ранжированием (точное → префикс → подстрока → pg_trgm-похожее), без LLM (B5) |
| edit | `frontend/src/services/ai.ts` | Типы: `weather`, `used_location`, `explanation.mood`, `explanation.weather_fit` |
| edit | `frontend/src/services/pois.ts` | Клиент `suggestPois` |
| edit | `docs/PERSONALIZATION_ARCHITECTURE.md` | Настроения этапа 6 |
| edit | `docs/WEATHER_INTEGRATION.md` | Погода в рекомендациях карты и AI, `weather_fit` |

Проверено: все модули бэкенда импортируются; SQL `suggest` компилируется под диалект PostgreSQL; реальный код ранжирования на синтетических строках (временный стенд вне репозитория): «фото» и «спокойный отдых» дают разные топ-5 (совпадение 2 из 5), «романтика + сильный мороз» поднимает кафе/ресторан с `weather_fit=indoor_in_adverse_weather`, при комфортной погоде — парк и набережную с `outdoor_in_good_weather`; `tsc` проходит. **Не проверено на реальной БД** (здесь нет PostgreSQL/PostGIS).
