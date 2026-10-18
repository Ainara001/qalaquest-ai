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

## Фаза 3 — `stage6/03-map-first-ui`

| Действие | Файл | Что сделано |
|---|---|---|
| create | `frontend/src/pages/MapHome.tsx` | Главный экран = карта: поиск, chips, слой рекомендаций, один лист снизу (места / карточка / маршрут / прогулка / планирование), активная прогулка (F1, F4, F5) |
| create | `frontend/src/components/map/Search.tsx` | Строка «Найти место или спросить AI…» и панель поиска: название → `/api/pois/suggest` без LLM, просьба словами → AI-гид в той же сессии (F2) |
| create | `frontend/src/components/map/FilterChips.tsx` | Chips «Настроение / Рядом / Время / Бюджет / Категории / Фильтры» с выбранными значениями + chip пожеланий из AI-гида |
| create | `frontend/src/components/map/Pickers.tsx` | Листы выбора: настроение (9 вариантов, одно нажатие, сброс), время, бюджет, категории, «рядом», фильтры, погода (F3) |
| create | `frontend/src/components/map/ResultsPanel.tsx` | «Места для вас»: 1–3 лучших с объяснением по источникам, список всех мест, ответ AI, «Построить прогулку» |
| create | `frontend/src/components/map/PlacePanel.tsx` | Карточка места: «Маршрут», «Сохранить», «Подробнее», причина, подтверждённые в OSM факты |
| create | `frontend/src/components/map/MapSheet.tsx` | Лист с тремя состояниями (свёрнут / половина / полностью), жест только за ручку |
| create | `frontend/src/components/walk/WalkPanels.tsx` | Предпросмотр маршрута, активная прогулка, планирование — теперь на карте |
| create | `frontend/src/stores/context.ts` | Общий контекст прогулки (настроение, время, бюджет, дети, погода, слой, пожелания AI), sessionStorage |
| create | `frontend/src/stores/mapui.ts` | Какая панель открыта, состояние листа, единственный открытый picker |
| create | `frontend/src/stores/recs.ts` | Слой рекомендаций: `/api/ai/search` по текущему контексту (без LLM) |
| create | `frontend/src/lib/query.ts` | Эвристика «название или просьба к AI» |
| create | `frontend/src/lib/reasons.ts` | Причины рекомендации раздельно: настроение / погода / запрос / профиль / отзывы |
| create | `frontend/src/lib/start.ts` | Стартовая точка маршрута: выбранная точка → геолокация по нажатию → центр (с пометкой) |
| delete | `frontend/src/pages/Home.tsx` | «Главная» дублировала карту; её функции перенесены на карту |
| delete | `frontend/src/pages/MapPage.tsx` | Заменена `MapHome` |
| delete | `frontend/src/pages/Walk.tsx` | Прогулка открывается на карте (`/walk` → `/?panel=walk`) |
| delete | `frontend/src/components/explore/ExplorePanel.tsx`, `PoiDetailView.tsx` | Заменены `PlacePanel` и левой панелью карты |
| delete | `frontend/src/components/walk/RouteSheet.tsx` | Заменён `MapSheet` |
| edit | `frontend/src/components/map/MapView.tsx` | Отдельный отключаемый слой рекомендаций (кольца), номерные пины, приглушение обычных POI, иконки категорий, кластеры до zoom 14, без поворота карты, отступ под лист |
| edit | `frontend/src/App.tsx`, `sections.ts`, `layouts/MainLayout.tsx` | 3 вкладки (Карта, AI-гид, Профиль); `/map`, `/explore`, `/walk` перенаправляются; на телефоне у карты нет шапки, учтены safe-area сверху и снизу |
| edit | `frontend/src/styles/globals.css` | `--safe-t`, `--header-eff`, высота страницы без шапки на карте |
| edit | `frontend/src/stores/profile.ts` | Настроение вынесено из профиля в контекст прогулки; `personalizationPayload` берёт сессию из общего контекста |
| edit | `frontend/src/stores/guide.ts` | Пожелания из ответа AI (интересы, исключения, время) синхронизируются в контекст карты |
| edit | `frontend/src/stores/explore.ts`, `hooks/useLocate.ts` | Общее состояние геолокации для всех кнопок |
| edit | `frontend/src/pages/Guide.tsx` | Chip настроения открывает тот же выбор, что и на карте; chips времени и бюджета |
| edit | `frontend/src/components/ChatMessages.tsx` | «На карте» и «Начать прогулку» открываются на карте без лишних экранов |
| edit | `frontend/src/components/walk/WalkParts.tsx` | Убрано дублирование уведомления «маршрутизатор недоступен» (ошибка этапа 5) |
| edit | `frontend/src/components/explore/parts.tsx` | Удалены неиспользуемые `SearchBox`, `OriginControls` |
| edit | `frontend/src/components/icons.ts`, `lib/categories.ts` | Иконки новых настроений и категорий |
| edit | `frontend/src/services/ai.ts`, `services/pois.ts` | `meta` в ответе AI, `tags` в карточке места |
| edit | `frontend/src/pages/Profile.tsx` | Ссылки на карту → `/` |
| edit | `frontend/src/i18n/locales/ru.json`, `kk.json` | ~120 новых строк RU/KK (обязательные переводы ТЗ §15), удалены ключи «Главной»; наборы ключей идентичны (669) |
| edit | `backend/app/services/personalization.py` | Приоритет времени: параметр > текст запроса > контекст прогулки > профиль (раньше время сессии перекрывало сказанное в чате) |

Проверено в браузере (375×812, 320×640, 1280×800) на временном тестовом API вне репозитория, который запускает **настоящий** код ранжирования, карточек и планировщика маршрутов на синтетических строках: старт сразу на карте, 3 вкладки, выбор настроения одним нажатием, «Фото» → архитектура/памятники, «Спокойный отдых» → парки/прогулочные зоны/кафе с раздельными причинами; поиск «Музеи 3» → карточка места; просьба словами → AI (без ключа — понятная ошибка 503 с повтором); «Маршрут» из карточки → предпросмотр с временем и расстоянием; RU→KK сохраняет настроение и карточку; нет горизонтального скролла на 320 px; `tsc` и `vite build` проходят. **Не проверено**: реальные POI, Valhalla и Gemini (их здесь нет), физические телефоны.

## Фаза 4 — `stage6/04-living-route-sync`

| Действие | Файл | Что сделано |
|---|---|---|
| edit | `frontend/src/stores/walk.ts` | Перестроение возвращает **предложение** (`proposal`); применяется только по «Применить», «Я посетил»/«Пропустить» — сразу; каждый `plan`/`replan` отправляет текущее настроение, бюджет, компанию и переключатель погоды из общего контекста (B7, F6) |
| edit | `frontend/src/components/walk/WalkPanels.tsx` | Карточка предложения (что изменится, новые итоги и остановки, «Применить» / «Оставить текущий»); баннер «настроение изменилось — предложить маршрут?» |
| edit | `frontend/src/pages/MapHome.tsx` | Карта рисует предлагаемый маршрут до решения пользователя; в полосе активной прогулки — «есть предложение» / «настроение изменилось» |
| edit | `backend/app/services/route_planning.py` | `feasible_ids`: какие места входили хотя бы в один допустимый план |
| edit | `backend/app/services/living_route.py` | Честные причины: `ranked_lower` вместо ложного «не помещается по времени», `matched_mood` вместо «по вашим интересам», когда совпадение только по настроению |
| edit | `frontend/src/i18n/locales/ru.json`, `kk.json` | Строки предложения, смены настроения, новых причин (682 ключа, наборы идентичны) |
| edit | `docs/LIVING_ROUTE_ARCHITECTURE.md` | Раздел «Stage 6: shared context and confirmation» |

Проверено в браузере на временном тестовом API с **настоящим** `LivingRouteService` и планировщиком (синтетические POI, без Valhalla — режим «по прямой»): «Построить прогулку» из «Мест для вас» → «Начать прогулку» → смена настроения на карте → баннер в панели прогулки и пометка в полосе → «Предложить маршрут» → карточка предложения, текущий маршрут не меняется → «Применить» → маршрут и `prefs.mood` обновлены. **Не проверено** с реальными Valhalla/POI.

## Фаза 5 — `stage6/05-surprise-me`

| Действие | Файл | Что сделано |
|---|---|---|
| create | `backend/app/services/surprise.py` | `SurpriseRecommendationService`: контекст → существующий `retrieve` → новизна по истории пользователя (не «популярность») → взвешенный выбор среди 5 лучших → объяснение из фактов; AI-идея только с проверкой, иначе идея «по типу места» |
| edit | `backend/app/schemas/context.py` | `SurpriseRequest`, `SurpriseResponse` |
| edit | `backend/app/api/ai.py` | `POST /api/ai/surprise` (лимит AI при наличии Gemini, иначе как у поиска; защита от двойного нажатия) |
| create | `frontend/src/services/advanced.ts` | Клиент режимов этапа 6 |
| create | `frontend/src/stores/surprise.ts` | Результат и история показанных мест (sessionStorage) — «Другой вариант» не повторяется |
| create | `frontend/src/components/map/SurprisePanel.tsx` | Карточка: название, почему, расстояние и время (оценки), что сделать, «Показать на карте», «Другой вариант», «Маршрут», «Подробнее» |
| create | `frontend/src/components/map/QuickActions.tsx` | Быстрые действия карты (пока «Удиви меня») |
| edit | `frontend/src/pages/MapHome.tsx` | Панель `surprise`, пин «?» на карте, быстрые действия над листом (телефон) и в левой панели (desktop) |
| edit | `frontend/src/stores/explore.ts` | Подпись пина может быть символом |
| edit | `frontend/src/i18n/locales/ru.json`, `kk.json` | Строки «Удиви меня» / «Мені таңғалдыр», причины, идеи по 16 типам мест |

Проверено на тестовом API с **настоящим** сервисом: 6 нажатий «Другой вариант» → 6 разных мест разных категорий, причины («новый для вас тип места», «ещё не предлагалось»), оценки времени, идея помечена «по типу места», дисклеймер о том, что «новое» ≠ «малоизвестное». Без ключа Gemini AI-текст не запрашивается.

## Фаза 6 — `stage6/06-ai-quest`

| Действие | Файл | Что сделано |
|---|---|---|
| create | `backend/app/services/quest.py` | `QuestGenerationService`: тип квеста → интересы поверх общего контекста → реальные POI через `retrieve` → 2–3 остановки и порядок через существующий `RoutePlanningService` (реальный пеший маршрут или помеченная оценка по прямой) → 2–5 заданий, привязанных к POI ID; факты только из тегов OSM; опционально AI-формулировки с той же проверкой, что и у рекомендаций |
| edit | `backend/app/schemas/context.py` | `QuestRequest`, `QuestTask`, `Quest` (6 типов квестов) |
| edit | `backend/app/api/ai.py` | `POST /api/ai/quests/generate` |
| create | `frontend/src/stores/quest.ts` | Квест и прогресс (pending → active → completed / skipped) в sessionStorage; выполнение подтверждает пользователь |
| create | `frontend/src/components/map/QuestPanel.tsx` | Выбор типа и числа заданий, задания со статусами, прогресс, «Начать квест», «Выполнено» / «Пропустить», правила безопасности |
| edit | `frontend/src/components/map/QuickActions.tsx` | Кнопка «Квест» |
| edit | `frontend/src/pages/MapHome.tsx` | Панель квеста, остановки и маршрут квеста на карте, полоса активного квеста |
| edit | `frontend/src/services/advanced.ts` | Типы и клиент квестов |
| edit | `frontend/src/i18n/locales/ru.json`, `kk.json` | Типы квестов, шаблоны заданий, статусы, уведомления |

Проверено: шаблоны заданий на наборе тестовых кандидатов (история: «прочитайте информацию на месте» + факт `historic=memorial` из OSM; семья; фотоохота; сравнение двух пространств); в браузере на тестовом API с настоящими сервисами — создание «Фотоохоты» и «Секретов города», честное уведомление «уместилось 1 из 3 мест» / «заданий меньше, чем запрошено», «Начать квест» → первое задание «Сейчас» → «Выполнено» → следующее; полоса квеста на карте. Без Gemini — шаблонные формулировки (так и подписано).

## Фаза 7 — `stage6/07-group-harmony`

| Действие | Файл | Что сделано |
|---|---|---|
| create | `backend/app/services/group.py` | `GroupRecommendationService`: общие жёсткие ограничения (самое короткое время, самый медленный темп, самый строгий бюджет, доступность, дети) → один RAG-поиск → оценка каждого места для каждого участника по тем же таблицам, что и персональное ранжирование → нормализация по участнику → выбор набора 1–3 мест по `0.6·min + 0.4·среднее + 0.1·ранжирование` → проверка по времени существующим планировщиком → объяснение компромисса |
| edit | `backend/app/schemas/context.py` | `GroupMember`, `GroupRequest` (2–5 участников), `MemberFit`, `GroupPlace`, `GroupResponse` |
| edit | `backend/app/services/route_planning.py` | `route_from_outcome` — общий для квестов и групп |
| edit | `backend/app/services/quest.py` | Использует `route_from_outcome` |
| edit | `backend/app/api/ai.py` | `POST /api/ai/groups/recommend` |
| create | `frontend/src/stores/group.ts` | Участники (sessionStorage), запрос, результат; личный профиль владельца телефона для группы не используется |
| create | `frontend/src/components/map/GroupPanel.tsx` | Компактные карточки участников (интересы, настроение, время, бюджет, темп, доступность, дети), результат: места с отметкой «кому подходит», насколько подходит каждому, почему такой выбор, «Перейти к маршруту» |
| edit | `frontend/src/stores/walk.ts` | `setDraft` — маршрут группы становится черновиком прогулки |
| edit | `frontend/src/components/map/QuickActions.tsx`, `pages/MapHome.tsx` | Кнопка «Для компании», места и маршрут группы на карте |
| edit | `frontend/src/services/advanced.ts`, `i18n/locales/*.json` | Типы и строки RU/KK (`Топпен серуендеу`); общий текст уведомления о старте из центра |

Проверено: алгоритм на примере из ТЗ (A — архитектура и фото, B — кофейни и спокойный отдых, C — музеи и история) → набор «архитектура + парк + памятник», каждый участник покрыт; в браузере на тестовом API с настоящими сервисами — три участника, честный компромисс («Болату рядом почти нечего предложить», «время — по самому короткому: 90 мин»), уровни «подходит / мало подходящего», переход к маршруту.

## Фаза 8 — `stage6/08-docs-verification`

| Действие | Файл | Что сделано |
|---|---|---|
| create | `backend/tests/__init__.py`, `conftest.py`, `test_stage6.py` | 17 модульных тестов без БД/сети/ключа: настроения, приоритеты контекста, атмосфера запроса, «Удиви меня» (новизна, выбор, причины), квесты (привязка к POI, факты OSM, число заданий), группа (пример из ТЗ, критерий минимальной удовлетворённости, общие ограничения), быстрый отказ погоды |
| create | `backend/pytest.ini`, `backend/requirements-dev.txt` | Запуск: `pip install -r requirements-dev.txt && pytest` |
| create | `frontend/src/components/ErrorBoundary.tsx` | Сбой одного экрана → сообщение «Перезагрузить», а не пустая страница |
| create | `docs/MAP_FIRST_UX.md` | Навигация, пользовательские пути, карта, поиск, Mood-Aware Map, листы, синхронизация контекста, мобильная адаптация |
| create | `docs/ADVANCED_AI_FEATURES.md` | `RecommendationContext`, Surprise Me, AI Quest, Group Harmony: алгоритмы, реальные POI, ограничения, статус проверки |
| edit | `backend/app/services/weather.py` | После сбоя Open-Meteo минуту отвечает «недоступно» сразу (слой карты не ждёт таймаут при каждом изменении фильтров) |
| edit | `backend/app/services/recommendation.py` | Порядок импортов |
| edit | `frontend/src/services/pois.ts` | Один общий запрос деталей места на минуту (карточка больше не делает два одинаковых запроса) |
| edit | `frontend/src/components/map/MapView.tsx` | Белые кластеры (не путаются с номерными пинами рекомендаций); фильтр выделения без предупреждения MapLibre «expected number, found null» |
| edit | `frontend/src/stores/mapui.ts`, `pages/MapHome.tsx` | Уход с карточки снимает выделение (повторное нажатие на ту же метку снова открывает её); карта подлетает к месту, даже если его нет среди нарисованных точек |
| edit | `frontend/src/layouts/MainLayout.tsx` | Error boundary вокруг страниц |
| edit | `frontend/vite.config.ts` | MapLibre в отдельном чанке (кэш не сбрасывается при обновлении кода приложения) |
| edit | `frontend/src/i18n/locales/ru.json`, `kk.json` | Тексты ошибки экрана (811 ключей, наборы идентичны) |
| edit | `README.md`, `docs/PROJECT_STATUS.md`, `docs/MOBILE_UI.md`, `docs/RAG_ARCHITECTURE.md`, `docs/STAGE6_AUDIT_AND_PLAN.md` | Статус этапа 6, новые эндпоинты, 3 вкладки, дополнения RAG, честный список непроверенного |

Проверено: `pytest` — 17 passed; `npm run build` проходит; ширины 320/390/430 px без горизонтального скролла на карте и во всех новых панелях; desktop 1280 px; казахский интерфейс новых панелей без «сырых» ключей.

## Фаза 9 — `stage6/09-polish` (P2)

| Действие | Файл | Что сделано |
|---|---|---|
| edit | `frontend/src/components/map/ResultsPanel.tsx` | В свёрнутом листе — превью лучшего места (нажатие открывает карточку); одноразовая подсказка «выберите настроение» (флаг в localStorage, исчезает после выбора); кнопка «Подобрать прогулку» — вход в планирование с параметрами (раньше эта панель была недостижима из интерфейса) |
| edit | `frontend/src/i18n/locales/ru.json`, `kk.json` | Тексты подсказки |
| edit | `docs/PROJECT_STATUS.md` | Устаревший пункт «лист без жеста перетаскивания» помечен как решённый |

Проверено в браузере (тестовый API + локальная заглушка LLM вне репозитория, как на этапах 3–5): просьба словами из поиска на карте → ответ AI в панели, время «40 мин» и пожелания «тихо, без музеев» перешли в фильтры карты; чат во вкладке AI-гид → chips «60 мин» и «Из AI-гида: кофейни, фотография» на карте, «На карте» → карточка места; «Сохранить» в карточке → место в «Сохранённых» профиля → «На карте» снова открывает карточку; «Подобрать прогулку» → центр, 90 мин → предпросмотр маршрута.

## Фаза 10 — `stage6/10-hardening`

| Действие | Файл | Что сделано |
|---|---|---|
| create | `backend/tests/test_api_validation.py` | 21 тест: новые эндпоинты отвечают 422 на неверный ввод до любой работы с БД/AI (1 или 6 участников, неизвестные поля и настроения, тип квеста, число заданий, параметры поиска по названию). Всего тестов: 38 |
| edit | `backend/app/services/group.py` | Группа без детей больше не считается «компанией друзей» (это смещало подборку к кафе и ТРЦ без оснований) |
| edit | `frontend/src/pages/MapHome.tsx` | Разные сообщения: «не удалось загрузить места на карте» (API недоступен) и «не удалось загрузить карту» (подложка) — раньше показывалось второе в обоих случаях |
| edit | `frontend/src/i18n/locales/ru.json`, `kk.json` | `explore.pointsLoadError` |
| edit | `docs/PROJECT_STATUS.md`, `docs/ADVANCED_AI_FEATURES.md` | Число тестов, список веток |

Проверено: при остановленном API — «Сервер не отвечает» + «Повторить» в «Местах для вас» и квестах, «Не удалось выполнить поиск» + вариант «Спросить AI» в поиске, приложение не падает; `pytest` — 38 passed; `tsc` проходит.

## Фаза 11 — `stage6/11-quest-on-map-motion`

| Действие | Файл | Что сделано |
|---|---|---|
| edit | `frontend/src/components/map/MapView.tsx` | Слой `quest-stops`: янтарные флажки остановок активного квеста (иконка генерируется один раз); одно обозначение на место — флажок или номерной пин важнее кольца рекомендаций |
| edit | `frontend/src/pages/MapHome.tsx` | Активный незавершённый квест виден на карте флажками, когда открыта другая панель (ТЗ §8 «активный квест показывай на карте»); плавное появление содержимого панели |
| edit | `frontend/src/components/BottomSheet.tsx`, `components/map/Search.tsx`, `styles/globals.css` | Плавное появление листов и панели поиска (180 мс), отключается при `prefers-reduced-motion` |
| edit | `docs/MAP_FIRST_UX.md`, `docs/ADVANCED_AI_FEATURES.md` | Описание флажков квеста и анимаций |

Проверено: квест создан и начат → панель закрыта → флажок остановки отрисован на карте (`queryRenderedFeatures` по слою `quest-stops`), полоса «Квест «Исследователь Астаны» · 0/3» видна; сборка проходит.

## Фаза 12 — `stage6/12-final-review`

| Действие | Файл | Что сделано |
|---|---|---|
| edit | `frontend/src/pages/Profile.tsx` | В «О приложении» — число реальных мест в базе, дата снимка OpenStreetMap и атрибуция (или «данные ещё не загружены»); раньше это показывала удалённая «Главная» |
| edit | `frontend/src/i18n/locales/ru.json`, `kk.json` | Тексты блока данных |
| edit | `backend/app/services/route_planning.py` | Импорт `Route` для аннотации под `TYPE_CHECKING` (замечание линтера F821) |
| edit | `backend/app/api/pois.py` | Убраны неиспользуемые импорты (`and_`, `PoiItem`) |
| edit | `frontend/package.json`, `package-lock.json` | Версия 0.6.0 (этап 6) |

Проверено: `ruff --select F,E9` по изменённым модулям — чисто (2 старых неиспользуемых импорта в не затронутых этапом 6 файлах оставлены); `pytest` — 38 passed; `tsc` проходит; блок данных в профиле отображается.
