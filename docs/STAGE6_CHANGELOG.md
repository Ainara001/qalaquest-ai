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
