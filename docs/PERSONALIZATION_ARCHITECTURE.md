# Personalization architecture (stage 4)

Goal: *two users, same city, different experiences* — through the existing RAG pipeline, not around it.
Personalization changes **which real POIs are retrieved and how they are ranked**; the LLM only explains the result.

## Preference model

| Level | Contents | Where it lives | Lifetime |
|---|---|---|---|
| **Persistent** (`UserPreferences`) | 16 interests, favourite / disliked categories, pace, budget, usual walk duration, max walking distance, indoor/outdoor, number of places (1–3), "with children" (only if set by the user) | Browser of this device (`localStorage`, key `qq-profile-v1`) **only after the user enables "Save on this device"**; otherwise in memory | Until the user resets or deletes it |
| **Accessibility** | wheelchair access needed | same as above | Applied as a requirement even when personalization is switched off |
| **Feedback** (`FeedbackSummary`) | POI ids per action: liked, more_like, saved, visited, not_interested, never; plus name/category snapshots for the Profile lists | same as above | Until cleared |
| **Session** (`SessionPreferences`) | today's mood, time left, today's budget, company, temporary exclusions, "also show public places with unknown price" | Memory of the page only | Current walk / tab |
| **Request** (`QueryIntent`) | what the user writes now ("no museums today", "something completely different", "40 minutes") | Extracted per message by the LLM; kept in the chat session on the server (memory, 2 h) | Current conversation |

Interests → real data (`backend/app/rag/taxonomy.py`):
- `AFFINITY`: interest → category weights (e.g. architecture → architecture 1.0, monument 0.7, attraction 0.6, public_space 0.5);
- `INTEREST_TAGS`: interest → supporting OSM tags (`historic=*`, `artwork_type`, `cuisine=coffee_shop`, `sport`, `fee=no`, …); a match is shown to the user as evidence;
- `INTEREST_PHRASES`: a short ru/kk/en description per interest; their e5 embeddings, weighted by the user's interests, form a **taste vector** compared with each POI embedding in pgvector.
- Moods are temporary weighted interest sets (`MOOD_INTERESTS`), e.g. "relax" → relax 1.0, parks 0.8, quiet 0.6, coffee 0.5.
  Stage 6 moods (`MAP_MOODS`): relax (calm rest), adventure, romantic, photo (beautiful photos), learn (educational walk), active, family, unusual ("surprise me"), just_walk; `inspiration` and `quiet` remain accepted for older clients. A mood is a ranking preference for the current walk, never a claim that a place is calm, romantic or uncrowded. Every card's `explanation.mood` and the `mood` source of `matched_interests` show what the mood contributed.

Budget: OSM has almost no prices (1 POI with `fee=no`, 0 with `charge` in this dataset). Therefore
- **"Only free" is strict**: only places whose source confirms free access (`fee=no`). If there are none, the user is told so (`no_confirmed_free`) and can explicitly ask to "show parks and squares whose price is not stated" — those are then labelled as unconfirmed.
- 2 000 / 5 000 / 10 000 ₸ are **soft**: no place is removed; commercial categories get a lower budget-fit score; the UI says prices are not in the data.
- An unknown price is never treated as free.

## Guest profile storage and privacy

- No account, no server-side profile table: nothing to read or modify "by id" on the server, no identification by IP, location or fingerprint.
- Saving is **opt-in** (banner after the first change + switch in Profile → Privacy). Without it everything is forgotten on reload.
- Stored: preferences, language, explicit POI ids with feedback and a name/category snapshot. Not stored: coordinates, movement history, AI messages, anything sensitive. The start point lives in memory only.
- The profile is sent with each AI request (`personalization` field) and validated by Pydantic with `extra="forbid"`: unknown fields (e.g. client "weights") → `422`. Weights exist only on the server.
- Profile → Privacy: "Clear feedback", "Reset preferences", "Delete all my data" (also clears the chat session). Each needs a second tap.
- Migration path: the same `UserPreferences` / `FeedbackSummary` schemas can be stored per authenticated user later; the client store has a version field (`v: 1`).

## Merge logic and priorities (`PersonalizationService.build`)

1. **This request** (chat text, explicit parameters) — highest.
2. **Session** (mood, time, today's budget, company, temporary exclusions).
3. **Persistent profile** — only if `use_profile=true` (switch "Use my preferences", default on once the profile is configured) **and** the request does not ask for "something completely different" (`ignore_preferences`).

Rules:
- Explicit exclusions win over persistent likes: a museum lover writing "no museums today" gets no museums; the profile is untouched, and soft interests whose main category is excluded today stop counting as matches.
- Explicit wishes win over persistent dislikes: a disliked category is excluded unless the user asks for it now.
- Requirements are never relaxed by soft preferences: accessibility (`wheelchair`), "never suggest again" ids, explicit exclusions, strict free, max walking distance and the time budget are SQL filters applied **before** ranking.
- With `use_profile=false` only the accessibility requirement and "never again" ids are sent; interests, budget, pace, favourites and learned feedback are not used.

## Personal ranking (`app/rag/retrieval.py`)

Pipeline: hard filters → signals for every remaining POI → weighted sum → feedback multipliers → relevance floor → diverse pick of 1–3 (count from the profile) → LLM explanation → validation.

| Score | Default weight | How it is computed |
|---|---|---|
| semantic | 0.20 | 0.8 × normalised cosine(query, POI) + 0.2 × keyword rank |
| interest | 0.25 | 0.7 × max(weight × category affinity) (+0.1 per extra matching interest) + 0.15 × supporting-tag match + 0.15 × normalised cosine(taste vector, POI); quiet penalises noisy categories. Source weights: request 1.0, session/mood 0.9, profile 0.7 |
| location | 0.15 | 1 − distance / radius (radius from time × pace speed, explicit radius, max walk) |
| time | 0.10 | how comfortably travel (straight line × 1.3 / pace speed) + typical visit fits the time budget |
| budget | 0.05 | `fee=no` 1.0; commercial categories 0.3 / 0.6 / 0.8 for 2 000 / 5 000 / 10 000 ₸ |
| context | 0.10 | favourite category, indoor/outdoor preference, company (family / friends / partner) |
| feedback | 0.10 | 0.5 + 0.5 × (0.6 × category affinity + 0.4 × similarity to liked places) |
| data | 0.05 | share of {localised name, hours, address, contact, description} present |

- Weights live in `app/core/ranking.py`, can be overridden with `RANKING_WEIGHTS` (JSON) and are re-normalised. Clients cannot send weights.
- Multipliers: visited × 0.6 (we look for new places), "not interesting" on this place × 0.4.
- Relevance floor: with interests, categories unrelated to them (affinity < 0.3) are dropped when ≥ 3 relevant places exist; categories the user liked through feedback stay.
- Diversity: 0.85 discount per already chosen place of the same category; same-named places are skipped.
- Missing data lowers `data` and the card's confidence; it is never filled in.

## Feedback learning (transparent, no fake ML)

Per category: `score = Σ action weight` over rated places (liked +1, more_like +2, saved +0.5, not_interested −1), `affinity = tanh(score / 4)`. One like gives +0.24 (small), four likes +0.76 — no categorical conclusion from a single click; the "you liked this category" label appears from 0.3 (two consistent signals).
With ≥ 2 positive signals a **liked vector** (weighted mean of the liked POIs' embeddings, more_like ×2) is compared with every candidate in pgvector, so places *similar* to liked ones rise even across categories.
"Never suggest again" is a hard filter until the user restores the place (Profile → Hidden places). "Already been here" lowers the place, "not interesting" lowers the place and slightly its category.

Measured on real POIs near Baiterek: 1 like on a monument → that category's feedback score 0.57; 3 "more like this" on monuments/attraction → 0.93 and the similarity label; "not interesting" on the top place removed it from the top 5.

## Link with RAG and the LLM

Personalization feeds the existing retrieval (filters + scores) and adds three SQL columns (query similarity, taste similarity, liked similarity). The 8 best candidates go to Gemini with a `why` object per candidate (matched interests with their source, matched tags, favourite category, feedback codes) and a `USER_PROFILE` summary. The prompt allows personal reasons **only** from these matches. The backend still validates ids and forbidden content as in stage 3.

"Why is this recommended to me?" in the UI is rendered from the ranking's `explanation` (matched interests + source, supporting OSM tags, feedback, distance, applied conditions, source fields used, score bars) — never from LLM text, and without prompts or internal data.

## Verified scenarios (real POIs, real embeddings)

Same start point (Baiterek, 2.5 km):
- **A** architecture + photo + unusual → Baiterek, Tabun Loshadey, artworks (Жетігенші, Қобызшы), gallery; **B** nature + parks + quiet → Сквер, Парк Жетысу, Sky Beach Club, the National Academic Library; overlap only 2 of 5, both differ from the no-profile baseline.
- **C** museum lover: museums present; with "no museums today" (session exclusion and, through chat, extracted from text) → no museums, profile unchanged.
- **D** "never suggest again" on Baiterek → absent from the next results, also with personalization off; verified in the UI too.
- **E** profile set but switch off → identical to the baseline (`profile_off`).
- **F** Kazakh UI: profile kept after the switch and reload; names and explanations in Kazakh.
- Strict free → 1 confirmed place in 2.5 km; with "show unconfirmed" → parks/squares labelled unconfirmed. Wheelchair → only the 5 places with OSM accessibility tags in range.

The chat flows (C via text, "something completely different", F answer language, places_count) ran against a **local stand-in for the Gemini REST API**; real Gemini output is still unverified because no API key is available.

## Limitations

- OSM data is thin: few prices, few accessibility tags, few descriptions, so budget and accessibility filters often leave very few places (reported honestly).
- Category affinities, tag rules and interest phrases are hand-written heuristics; no learned model and no offline evaluation set.
- Feedback lives on one device; clearing browser data removes it. No sync between devices.
- The taste vector depends on short phrases; it is a weak signal (15 % of the interest score).
- Indoor/outdoor and company signals are category-level, not place-level facts.
- Session context on the server is in memory (lost on restart).
