# Living Route architecture (stage 5)

## Routing engine

**Valhalla 3.9 (self-hosted, Docker service `valhalla`)**, pedestrian costing, built from the OpenStreetMap extract of Kazakhstan (Geofabrik, ODbL).

- Why Valhalla: a real pedestrian profile (footways, crossings, steps), a wheelchair variant (`pedestrian.type = wheelchair`, used when the user needs step-free access), a many-to-many matrix endpoint (`sources_to_targets`) for ordering, per-request walking speed, and a small footprint (tiles ~320 MB, build ~10 min on a laptop). No external quota: public routing demo servers are not used.
- Setup: `./routing/prepare.sh` downloads the extract with resume/retry into `routing/data/` (git-ignored); `docker compose up -d valhalla` builds the tiles on first start and reuses them later. Check: `GET /api/routes/status`.
- Walking speed follows the profile pace: slow 3.6 km/h, normal 4.8 km/h, active 6.0 km/h (Valhalla default is 5.1).
- Example (real): Baiterek → Khan Shatyr = 2.47 km / 31 min on foot; the straight line is 1.93 km, the car route 3.2 km.

Client: `backend/app/integrations/valhalla.py` — 15 s timeout, 30 min in-memory cache of identical requests, polyline6 decoding (verified against the reference example), errors split into `RoutingUnavailable` (engine down) and `NoRoute` (no path / no road near a point).

## Building a route (`RoutePlanningService`)

Input: start point, candidate POIs (from the personal RAG ranking, or 1–3 POIs chosen by the user/AI guide), time budget, pace, max walking distance, weather assessment, accessibility, required/kept POIs.

1. **One matrix call** (start + ≤ 9 candidates, all-to-all walking time and distance).
2. **Exhaustive search** over every subset of up to `places_count` (1–3, from the profile) and every visiting order (≤ 400 combinations; logged as `alternatives_considered`).
3. **Hard checks** per combination: `total ≤ time budget`, `walking distance ≤ max walk`, `outdoor minutes ≤ weather/indoor cap`. A combination that violates any of them is discarded — the score can never buy it back.
4. **Objective** among feasible plans: Σ personal ranking score (stage 4) + 0.15 per stop kept from the previous route (stability) + 0.05 per distinct category (diversity) − 0.15 × time used / budget − 0.10 × walking used / max. The largest feasible number of stops wins.
5. **Fallbacks, always reported:** relax the weather cap (`weather_cap_relaxed`) → fewer stops (`route_fewer_stops`) → `no_feasible` with the minimum time that the closest option needs (`route_time_too_short`), or `route_too_far` / `route_no_path` / `route_no_candidates`.
6. **Geometry:** one `/route` call for the chosen order → per-leg distance, time and line. The order is labelled `shortest_walk_order` when it is the shortest walk among all orders of the chosen set, otherwise `best_score_order`.

## Time model

`total = walking (Valhalla, at the user's pace) + visits (typical minutes per category, ESTIMATE) + buffer (max(3 min, 10 % of walking))`.
Visit minutes are shown as "≈N min (estimate)"; arrival offsets are cumulative estimates. A 60-minute request never gets a plan whose computed total exceeds 60; if the real geometry turns out slightly longer than the matrix estimate, the route is flagged `route_over_budget` instead of being silently accepted. Opening hours are shown when OSM has them; "open now" is never claimed.

## RouteSession (client-held)

Stored in `sessionStorage` (`qq-walk-v1`), so a tab switch, language switch or reload keeps the walk; nothing is kept on the server between calls.

| Field | Meaning |
|---|---|
| `id`, `version`, `started_at` | identity, optimistic versioning, age (sessions older than 12 h → `409 session_expired`) |
| `start`, `current` | original start and the latest known point (device location only on an explicit tap, or "last visited place", or manual) — no movement history |
| `stops`, `visited`, `skipped`, `rejected` | POI ids |
| `time_budget_min`, `budget{minutes, at}` | remaining time is derived on the client from elapsed time |
| `prefs` | walk-only wishes: less walking, indoor, mood, interests, excluded categories |
| `route`, `change` | the latest computed route and the last diff |

## Re-planning (`LivingRouteService.replan`)

Events: `time_left`, `less_walking`, `tired`, `go_indoor`, `visited`, `skip`, `reject`, `add_poi`, `location`, `interests`, `mood`, `weather_refresh`, `manual`, `message` (free text → Gemini query understanding; returns `503 ai_*` without a key, quick actions keep working).

1. Apply the event to the walk state (e.g. "visited" adds the POI to `visited`).
2. Choose the restart point: new location from the event > `current` > the last visited POI (reported as an assumption) > the original start (reported).
3. Build the personal context (request > walk prefs > persistent profile, stage 4) with the remaining time; `less_walking` → slow pace + max 1.2 km walking; `go_indoor` → 10-minute outdoor cap.
4. Exclude visited/skipped/rejected POIs; fetch weather for the current point (cached).
5. Retrieve candidates around the **current** position (reach = half of the remaining time, capped by the profile's max walk); pending stops are re-checked against all hard filters and get the continuity bonus.
6. Plan as above, then **diff** with the previous route: `kept`, `removed` (reason: visited, skipped, rejected, filtered by the new conditions, outdoor limit, time/distance, finished), `added` (requested, indoor by request/weather, matched interest, close, ranked), before/after minutes and metres, and the condition changes that triggered it. Every reason is derived from what the algorithm actually did.
7. Optional Gemini summary of the computed facts; the backend drops it if it contains any number that is not in the facts (verified: an invented "2500 тенге, 7 минут" summary was discarded).

## Stage 6: shared context and confirmation

- **Same context as the map and the AI guide.** Every `plan` / `replan` sends the current walk context from `stores/context.ts` (mood, budget, company, weather switch) in `personalization.session` and `use_weather`; `session.prefs.mood` is always today's mood, so an old mood stored with the walk can no longer override a newer one chosen on the map.
- **Changes are proposals.** `time_left`, `less_walking`, `go_indoor`, `interests`, `reject`, `location`, `weather_refresh`, `mood` and free-text `message` return a proposal: the panel shows what changes and why (`ChangeSummary`), the new totals and stops, and the map draws the proposed route; the walk continues on the current route until the user taps **Apply** (or **Keep current**). Progress marks (`visited`, `skip`) apply at once. The server is unchanged (it was already stateless); the client simply does not store the result until it is confirmed.
- **Mood changed during a walk.** If the mood on the map / in the AI guide differs from the walk's mood, the walk panel and the active-walk bar say so and offer "Suggest a route" (a `mood` event → proposal). Nothing is re-planned automatically.
- **Honest diff reasons (fixed).** A stop that still satisfied every constraint but lost to better-matching places is now `ranked_lower` (it used to be reported as `time_or_distance`); the planner records `feasible_ids` (stops that appeared in at least one feasible plan). A stop added only because of the mood is `matched_mood`, not "your interests".

## Personal AI link

The stage 4 `PersonalizationService` and ranking feed the candidate pool unchanged (interests, favourite/disliked categories, budget rules, accessibility as a hard filter and `wheelchair` routing, feedback incl. "never again", mood). Walk-time wishes (e.g. "no more photos, I want to sit") are session prefs and never modify the stored profile.

## Error handling

| Situation | Behaviour |
|---|---|
| Routing engine down / no path | `straight_line_only`: real POIs, straight-line distances labelled `geodesic_straight_line`, **no line drawn**, notice `routing_unavailable` |
| Invalid coordinates / point > 40 km from Astana | `422` (`validation_error` / `out_of_area`) |
| POI missing | `route_poi_missing` |
| Not enough time / too far / nothing matches | `no_feasible` + `route_time_too_short` / `route_too_far` / `route_no_candidates` |
| Weather down | route without weather adaptation + `weather_unavailable` |
| Geolocation denied | message, manual point picking stays available |
| Gemini down | free-text changes return `503 ai_*`; quick actions and planning work; no summary text |
| Session too old | `409 session_expired` |
| Duplicate taps | identical requests share one result (dedupe), 30 req/min per IP |

## Verified (real Valhalla, real POIs, real Open-Meteo)

Plan through 1 and 2–3 POIs; geometry on the map; per-leg and total times; visit estimates in the total; time budget respected (Khan Shatyr alone needs 93 min → refused for 90); profile changes the POIs and the pace (slow 3.6 km/h); replan after "visited" (restart from the visited place, 84 → 74 min), "25 minutes left" (honestly infeasible: the only short-visit place within reach is 1.2 km away), "less walking" (74 → 46 min, 1.6 → 0.7 km), "go indoor" (outdoor ≈7 min, the library added), new location near Mega Silk Way (stops replaced by NU Park), interests → coffee (a café added); engine stopped → straight-line mode without a drawn line; out-of-area and stale-session errors; UI flow in Kazakh and Russian on a 375 px phone.
