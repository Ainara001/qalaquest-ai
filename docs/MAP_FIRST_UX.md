# Map-first UX (stage 6)

The map of Astana is the application. Search, mood, filters, recommendations, place cards, routes, the active walk,
Surprise Me, quests and group walks all open **over the map**; the bottom navigation has three tabs.

## Navigation

| Tab | Route | Contents |
|---|---|---|
| **Map** (Карта / Карта) | `/` | Search, quick filters, mood, "Places for you" layer, place cards, quick routes, the active walk, Surprise Me, Quest, For a group |
| **AI guide** (AI-гид / AI-гид) | `/guide` | Full conversation with the AI planner: refining recommendations, planning walks, explanations, history of the current session |
| **Profile** (Профиль / Профиль) | `/profile` | Persistent preferences, interests, accessibility, saved / visited / hidden places, RU/KK, privacy |

- The former **Home** tab duplicated the map and was removed; its parts moved to the map (AI input → search field, mood row → mood chip, weather card → weather button, "places you may like" → the recommendation layer, quick scenarios → AI suggestions in the search panel).
- Old addresses still work: `/map` and `/explore` → `/`, `/walk` → `/?panel=walk`.
- Quests, weather, Surprise Me and walks are **not** tabs; they open in context on the map.
- Desktop (≥ 768 px): the same three items in the header; the map takes most of the screen, the left 400 px column holds the search, filters, quick actions and the current panel.

## Main user paths

| Goal | Steps |
|---|---|
| Find an interesting place | open the app → tap **Mood** → choose → the map and "Places for you" update |
| Build a walk | open the app → type a request in the search field → AI answer on the map → **Start a walk with these places** (or **Build a walk through N places** from the list) |
| Look at a place | tap a marker → place card (bottom sheet) |
| Route to a place | place card → **Route** → line, time, distance on the same screen → **Start walk** |
| Change the route | active-walk bar → **Change route** → choose a condition → review the proposal → **Apply** |
| Start a quest | map → **Quest** → choose a type → **Create** → **Start quest** |

No path goes through Home → Explore → Planner → Route any more.

## The map

- MapLibre GL with OpenFreeMap (light *positron* style by default, dark on request), labels in `name:kk` / `name:ru` where the tiles have them.
- Regular POIs: clustered GeoJSON source (clusters up to zoom 14, so the city view never shows hundreds of identical dots), coloured markers with white category pictograms from zoom 13.5, the selected place has an amber ring.
- **Recommendation layer** (separate source, switch on the map and in Filters): the top 1–3 places as numbered pins, the next ones as teal rings. While a mood or AI wishes are active the regular markers are drawn faded — never removed: search and the "All places" list still contain every POI.
- Route line (Valhalla pedestrian geometry) for the route preview, the active walk, a re-plan proposal, a quest or a group walk. In straight-line mode nothing is drawn (only real routes are drawn).
- Buttons over the map: weather (comfort level; opens the weather card), recommendation layer on/off, my location. Pinch zoom on phones; rotation is disabled.
- Fly-to keeps the selected place above the bottom sheet (`bottomInset`).

## Search ("Найти место или спросить AI…")

One field, two kinds of input, detected automatically (`lib/query.ts`), the other option always one tap away:

| Input | What happens | Cost |
|---|---|---|
| A place name ("Ботанический сад", "Хан Шатыр", with typos) | `GET /api/pois/suggest`: exact → prefix → substring → trigram-similar names (pg_trgm), ranked, with distance; matching categories offered as "All: Cafés (318)". Tap → place card | database only, never the LLM |
| A request in words ("хочу спокойно погулять около часа", "куда сходить с ребёнком?") | sent to the AI guide in the **same chat session** as the AI tab (RAG + personal ranking + Gemini); the answer opens in the "Places for you" panel with numbered pins | one AI request |

Requests are recognised by question marks, ≥ 5 words, or request words in RU/KK/EN ("хочу", "куда", "погулять", "минут", "қайда", "серуен", "тегін"…). Enter sends the obvious choice (AI for requests, the first place for names).

## Quick filters

Chips under the search field always show their current value and all go to the backend:

| Chip | Values | Effect |
|---|---|---|
| Mood | 9 moods (see below) | `personalization.session.mood` → ranking of the layer, the AI guide and Living Route |
| Near | my location / a point on the map, radius 1–5 km, or the whole city | `location` + `radius_m` |
| Time | 30–180 min or none | `time_minutes` (hard filter: getting there + typical visit must fit) |
| Budget | free (confirmed only) / ≤ 2 000 / 5 000 / 10 000 ₸ / any | strict `fee=no` filter or soft commercial-category score; the hint says prices are rare in OSM |
| Categories | any of the 16 | regular POI layer **and** the layer request |
| Filters | with children, wheelchair access, use weather, recommendation layer, use my profile, show unconfirmed free | session company, accessibility requirement, `use_weather`, layer visibility, `use_profile` |

A seventh chip appears when the AI guide understood wishes from the conversation ("From the AI guide: coffee, without museums ✕").

## Mood-Aware Map

- Moods (`MAP_MOODS`): calm rest, adventure, romantic walk, beautiful photos, educational walk, active rest, family walk, "surprise me", just walk. RU/KK labels in `mood.*`, short chip labels in `moodShort.*`.
- One tap in the mood sheet selects and closes; **Reset mood** is always there. The mood belongs to the current walk (sessionStorage), never to the profile, and needs no profile.
- After a change: the layer request is recomputed (`/api/ai/search`, no LLM), the map frames the new top 1–3, the list explains every place **by source**: "Kind of place matches the mood «…»", "Because of the weather: usually indoors", "Matches your request: …", "Your interests: …", "Similar to places you liked", distance. The current route is never changed without confirmation.
- A mood is a ranking preference: no card says that a place *is* quiet, romantic or uncrowded (the list footer says so explicitly).

## Bottom sheets

- One persistent sheet (`MapSheet`) holds exactly one panel: Places for you · Place card · Route preview · Walk · Plan · Surprise · Quest · Group. Three snap states: collapsed (title + key numbers), half, full (stops below the search and filters). Only the handle drags/toggles, so map gestures and list scrolling are never hijacked; buttons in the header stay buttons.
- Pickers (mood, time, budget, categories, near, filters, weather) are short modal sheets; only one can be open.
- Place card: Route · Save · More; why it is suggested (by source); address; hours or "unknown"; facts confirmed by OSM tags (free entry, wheelchair, cuisine, Wi-Fi, outdoor seating, historic object, artwork); "More" adds phone, website, description, names, coordinates, source and the note that photos are not shown (no licensed source).

## Context synchronisation

`stores/context.ts` is the single current-walk context (mood, time, budget, unconfirmed-free, with children, weather switch, layer switch, AI wishes). `personalizationPayload()` puts it into `personalization.session` of **every** request: the map layer, the AI guide chat, Surprise Me, quests, `routes/plan` and `routes/replan`.

| Change | Effect |
|---|---|
| Mood on the map | layer recomputed; the AI guide shows and uses the same mood; an active walk shows "mood changed — suggest a route?" |
| Mood in the AI guide (chip) | same store → the map layer updates |
| Wishes in the chat ("no museums", "coffee", "40 minutes") | copied into the context (`aiWishes`, time) → the layer updates; removable chip on the map |
| Any re-plan | sends today's mood/budget/company/weather switch; the walk's own stored mood can no longer override it |

Persistent preferences (`stores/profile.ts`) and current filters stay separate: the profile is used only when "Use my preferences" is on.

## Mobile

- No header on the map screen on phones: the search field sits at the top with `env(safe-area-inset-top)`; the bottom bar keeps `env(safe-area-inset-bottom)`; page height follows the visual viewport (`--vvh`), the bottom bar hides while the keyboard is open.
- Touch targets ≥ 40–48 px, 16 px inputs (no iOS zoom), horizontal chip rows scroll inside themselves.
- Checked without horizontal page scroll at 320, 375, 390 and 430 px (emulation); quick actions and map buttons sit above the sheet and disappear when it is full.
- Tab switches keep the search state, results, the open place card, the walk, the quest and the group (stores + sessionStorage).

## Limitations

- Tested in the in-app browser with phone emulation against a scratch API that runs the real ranking/planning code on synthetic rows (no PostgreSQL, Valhalla or Gemini on that machine). Not tested on physical phones or with the real database.
- The query-type heuristic can misread unusual names that contain request words; the other option is always shown.
- The MapLibre chunk is ~260 kB gzip; it is code-split but is part of the first screen now.
