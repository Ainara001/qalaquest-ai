# Advanced AI features (stage 6): AI Quest, Group Harmony, Surprise Me

All three are built **on the existing pipeline**, not next to it: the same `RecommendationContext`, the same
`PersonalizationService`, the same hybrid retrieval (`app/rag/retrieval.py`) over real OpenStreetMap POIs, the same
`RoutePlanningService` (Valhalla) and the same validation of AI text. None of them needs Gemini to work; Gemini only
rewords texts when it is configured, and its text is validated like every other AI answer.

## Shared RecommendationContext

`backend/app/schemas/context.py` → `RecommendationContext`; helpers in `backend/app/services/context.py`.

| Spec concept | Field / source |
|---|---|
| Location | `location` (device or chosen point; else the city centre with a `default_start_point` notice) |
| Language | `lang` (ru / kk) — every text the user sees is rendered in it |
| Mood | `personalization.session.mood` |
| Interests | `personalization.profile.interests` (persistent, only with `use_profile`) + `personalization.session.interests` (today, e.g. AI-guide wishes) |
| TimeBudget | `time_minutes` |
| MoneyBudget | `personalization.session.budget` > `personalization.profile.budget` |
| WalkingPreferences | `personalization.profile` (pace, max walk, indoor/outdoor, number of places) |
| AccessibilityConstraints | `personalization.wheelchair` — a requirement, applied even with the profile off |
| WeatherContext | `use_weather` → Open-Meteo assessment for the start point and time window |
| ExcludedCategories | `exclude_categories` + session exclusions + disliked categories |
| VisitedPoiIds | `personalization.feedback.visited` (+ `exclude_poi_ids` for "not again in this session") |
| CurrentSessionPreferences | `personalization.session` |

Every mode does: `resolve_start` → `assess_weather` → `build_context` (request > session/mood > profile) → `retrieve`.
`/api/ai/search` (the mood-aware map layer), `/api/ai/recommend|chat`, `/api/routes/plan|replan`, `/api/ai/surprise`,
`/api/ai/quests/generate` and `/api/ai/groups/recommend` therefore rank the same places the same way for the same context.
The frontend builds that context in one place (`stores/context.ts` + `personalizationPayload()`).

### Mood × weather × interests

The ranking has a `weather` score (weight 0.10): in uncomfortable weather "usually indoor" categories get 1.0 and
"usually outdoor" ones 0.2; in comfortable weather outdoor 0.9, indoor 0.6 (category-level, never a claim about a
building or wind shelter). Each card now says what came from where:

- `explanation.matched_interests[].source = "mood"` → "Kind of place matches the mood «…»";
- `explanation.weather_fit = indoor_in_adverse_weather | outdoor_in_good_weather` → "Because of the weather…";
- sources `profile` / `request` / `session`, `favorite_category`, `feedback` → interests, the request, likes.

Example (real ranking code on test rows): mood *romantic* + "very cold" puts a café and a restaurant first
(`indoor_in_adverse_weather`); the same mood in comfortable weather puts a park and a promenade first (`outdoor_in_good_weather`).

## Surprise Me — `POST /api/ai/surprise`

`SurpriseRecommendationService` (`backend/app/services/surprise.py`).

1. Context as above; without a point, radius or time the search circle is 6 km around the centre (reported).
2. Candidates: personal retrieval, limit 30. Excluded: places offered earlier in this session (`exclude_poi_ids`, kept by the client), visited, liked, saved — they would not surprise; plus every hard filter (never-again, accessibility, strict free, time).
3. **Novelty from the user's own history, never from popularity** (there is no popularity data): category not favoured, not liked and not shown in this session → 1.0; favoured/liked → 0.4; already shown this session → 0.2. Categories that are usually "unusual" (attraction, architecture, gallery) get a small bonus.
4. `score = 0.55 × relevance (personal ranking, normalised in the pool) + 0.35 × novelty + 0.10 × unusual-category`; one of the 5 best is drawn with weights ∝ score, so "Another option" gives a different, still relevant place, never the same one twice.
5. Response: the real POI card, reason codes (`mood`, `interests`, `new_category`, `unusual_category`, weather fit, `close`, `not_shown_before`), straight-line travel estimate and typical visit time (both labelled as estimates), "what to do" — a validated AI idea, or a category-level idea labelled "idea for this kind of place", and the size of the candidate pool. The UI states that "new" means new *for you*, not little-known.

## AI Quest — `POST /api/ai/quests/generate`

`QuestGenerationService` (`backend/app/services/quest.py`). Types: explorer, photo hunt, architecture, history walk, family adventure, city secrets.

1. Quest type → weighted interests (session level) on top of the walk context (mood, profile, time, budget, weather, accessibility; "family" also allows unnamed playgrounds).
2. Real POIs from retrieval (pool 9, reach = half of the time at the user's pace).
3. The existing `RoutePlanningService` picks 2–3 stops and their order within the time (whole typical visits + buffer must fit; weather outdoor cap; wheelchair routing) — real pedestrian geometry, or labelled straight-line estimates if the router is down.
4. Tasks (2–5) from templates bound to POI ids: per stop (photo from an unusual angle, find a facade detail, *read the information on site if there is any*, choose one exhibit, rest stop, play with children, three unnoticed details) and across stops (two different public spaces, compare two places, photo series, favourite stop). A second, different task per stop is added when few stops fit; fewer tasks than requested is reported (`quest_fewer_tasks`). Facts are only OSM tags of that place (`historic=memorial`, `artwork_type`, `cuisine`…); unknown opening hours are flagged on the task.
5. Templates never state facts, events or exhibits, and never ask to enter closed areas; the panel says to respect the rules of places.
6. Optional Gemini wording of the title and tasks: same task ids, no numbers/times/prices/ratings/"open now" outside the facts (validator from the recommendation service); otherwise templates (`generated_by` tells which).
7. Progress is client-held (sessionStorage), like the walk: `pending → active → completed / skipped`; the user confirms each task — there is **no** automatic completion detection, and the UI says so. The active quest is shown on the map (stops + route) and in a compact bar.

## Group Harmony — `POST /api/ai/groups/recommend`

`GroupRecommendationService` (`backend/app/services/group.py`). 2–5 members entered on one device, no accounts, no invitations, no chat.

Each member: name (optional), interests (the 16 profile interests), mood, budget, time, pace, wheelchair, children.

1. **Common hard constraints**, the strictest member wins: shortest time, slowest pace, strictest budget ("free" if anyone needs it), wheelchair access if anyone needs it, children if anyone has them. The device owner's personal taste is not used (only their "never again" places and accessibility need).
2. One RAG search with all members' interests and moods (session level) → pool of 24 real POIs.
3. **Per-member fit** of every candidate with the same transparent tables as the personal ranking: `fit = max(weight × category affinity)` over the member's interests (mood interests × 0.9), `+0.15` if an OSM tag supports one of them; members without interests use the default sightseeing profile.
4. **Normalisation per member**: divided by that member's best fit in the pool, so someone whose interests are rare in the data is not drowned out.
5. **Set selection**: for every set of 1–3 places from the best 12, satisfaction of a member = their best normalised fit in the set; `objective = 0.6 × min(satisfaction) + 0.4 × mean(satisfaction) + 0.1 × mean ranking score`. The min term ("least satisfied member") keeps one member's interests from dominating (tested: three architecture places lose to a mixed set when another member wants coffee).
6. The best sets are checked with the route planner against the common time budget; the first feasible one wins (multi-stop sets first, then single places).
7. Response: places in walking order with "fits: A, C", per-member satisfaction (high ≥ 0.8, medium ≥ 0.5, low) from the real calculation above, the compromise in codes (`group_shared_place`, `group_everyone_covered`, `group_member_not_covered` with that member's interests, shortest time / slowest pace / strictest budget, accessibility, children), the route, and how many sets were checked. If no common option exists, it says so and why.

Example from the spec (test rows): A — architecture, photo; B — coffee, calm rest; C — museums, history → architecture + park + monument, every member covered.

## Real POIs only, incomplete data

- Every place is a database record (OSM); cards are built from its fields. AI never supplies names, coordinates, hours, prices or distances.
- Unknown hours → "hours unknown"; prices: only `fee=no` counts as free; accessibility only where tagged; mood and quest themes are preferences, not claims about atmosphere, safety or crowds.
- Too little data or time → explicit notices (`no_results`, `quest_no_places`, `quest_fewer_tasks`, `group_no_feasible`, `surprise_none`, `route_time_too_short`) with a way to change filters.
- Rate limits: Surprise and Quest use the AI limit when Gemini is configured (retrieval limit otherwise); Group uses the retrieval limit (no LLM). Identical requests in flight share one result.

## Verification status

- Unit tests (`backend/tests/test_stage6.py`, no DB/network/key): moods, context priorities, Surprise novelty and draw, quest tasks, group objective and constraints, weather fail-fast; request validation of the new endpoints (`test_api_validation.py`: 2–5 members, unknown fields and moods, quest types and task counts, suggest parameters) — 38 passed.
- UI flows in the in-app browser against a scratch API that runs these real services on synthetic rows (no PostgreSQL/PostGIS, Valhalla or Gemini on that machine): six "another option" draws → six different places; photo / city-secrets quests with progress; three-member group with an honest compromise.
- **Not verified with the real database, Valhalla or Gemini.** To verify: `docker compose up`, import and index POIs, then call the three endpoints (Swagger at `/api/docs`) and the scenarios in [PROJECT_STATUS.md](PROJECT_STATUS.md).
