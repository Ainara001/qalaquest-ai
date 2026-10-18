# RAG architecture (stage 3)

```
user text ──► Query understanding (Gemini, structured output, session context)
                    │  QueryIntent: start place, time, interests, include/exclude categories, budget, transport…
                    ▼
        start point: map POI id > place named in the text (fuzzy match in DB) > device/manual location > city centre (reported)
                    ▼
        Retrieval in PostgreSQL (hard filters → vector + keyword + geo + affinity → rerank → diverse pick)
                    ▼   8 real candidates
        Gemini writes: which 1–3 ids fit + reason + activity idea (structured output)
                    ▼
        Backend validation (ids ∈ candidates, no invented times/prices/ratings) → cards built from DB fields
```

## Data source

The only knowledge source is the `pois` table (real OpenStreetMap objects, see [POI_DATA_PIPELINE.md](POI_DATA_PIPELINE.md)). Each row keeps its OSM id and source URL, so every card links back to the record.

## Embedding model

`intfloat/multilingual-e5-large` (1024 dimensions), run locally through **fastembed** (ONNX, CPU). Chosen because it covers Russian, Kazakh and English in one space, so a Kazakh query can match a place whose only name is Russian or Latin. No API key is needed for retrieval. Query/passage prefixes (`query: ` / `passage: `) required by e5 are added by `EmbeddingService`. The model (~2.2 GB) is downloaded once into the `modelcache` Docker volume and loaded in the background at backend start (~15 s); a query embedding takes ~0.2 s.

Not measured: retrieval quality benchmarks (no labelled data exists for Astana POIs). The examples below are manual checks.

## Index

`poi_index` (migration `0003`): `poi_id` (FK → `pois.id`, `ON DELETE CASCADE`), `doc`, `content_hash`, `model`, `embedding vector(1024)`, generated `tsv` (`to_tsvector('russian', doc)`), HNSW cosine index and GIN index.

The document (`app/rag/documents.py`) contains only real data: names (ru / kk / en / original), the category in three languages, subtype, descriptions if OSM has them, a whitelist of tags (cuisine, sport, religion, artwork type, operator, fee, internet access, …) and the address. Nothing is invented; most places only have a name and a category, which is why the interest ↔ category table below matters.

Indexing: `python -m app.scripts.index_pois` (`--force` to redo everything). `content_hash = sha256(model + document)`, so unchanged documents are skipped and a changed POI or a different model is re-embedded; batches of 32, a failing batch is logged and does not stop the rest. `import_pois --index` refreshes the index after an import. Deleting a POI removes its index row.

Result of the real run: 1030 documents embedded, 0 failed; a second run skipped all 1030.

## Query understanding

`QueryIntent` (Pydantic, enforced through Gemini structured output): start place, time in minutes, interests (closed vocabulary of 16 values), explicit include / exclude categories, budget, atmosphere, transport, children, wheelchair, "want alternatives", answer language, and a short `semantic_query` for the embedding. The prompt says to leave fields empty unless stated. In a chat, the previous constraints are passed back so "no museums" or "something else" modifies the earlier request; context lives in memory for the current session only (2 h TTL, 500 sessions, last 8 turns). A greeting or an unusable message produces one clarification question instead of a search.

UI parameters (location, time, radius, free, with children, profile interests, an anchor POI from the map) are merged with the extracted intent.

## Start point and distances

Priority: POI chosen on the map > place named in the text (fuzzy match with `pg_trgm` + `ILIKE` against all name variants; e.g. "MEGA Silk Way" → the real `Mega Silk Way` object) > device / manual location > city centre (Baiterek) with a visible notice. An unknown named place without any location triggers a clarification (`anchor_not_found`). The anchor itself is never recommended.

Distances are PostGIS geodesic **straight-line** distances (`distance_method = geodesic_straight_line`). In the AI cards the "travel estimate" is only `distance × 1.3 / speed` (walk 80 m/min), flagged `straight_line_x1.3_walk` and worded in the UI as a rough estimate, not a route. Real pedestrian routes (Valhalla) exist since stage 5 and are used by `/api/routes/*` — see [LIVING_ROUTE_ARCHITECTURE.md](LIVING_ROUTE_ARCHITECTURE.md).

## Retrieval and filtering (`app/rag/retrieval.py`)

Hard constraints are applied in SQL before any ranking: radius (`ST_DWithin`), included / excluded categories, `fee=yes` excluded when the user wants free, wheelchair `yes/designated` when requested, already shown places when asking for alternatives, named objects only (unnamed playgrounds only for children). The time budget is a hard filter too: walking estimate + half of the typical visit must fit in the available time. The radius comes from the smallest of: user radius, stated distance, and a time-derived radius (≈35 % of the time budget for getting there, 5–45 min).

Scoring over every row that passed the filters (about a thousand POIs, so similarities are computed exactly; the HNSW index is in place for larger data).

> **Superseded in stage 4.** The table below is the original stage 3 scoring. The current ranking uses nine explainable scores (semantic, interest, location, time, budget, context, feedback, data, weather) with the weights in `backend/app/core/ranking.py`; see [PERSONALIZATION_ARCHITECTURE.md](PERSONALIZATION_ARCHITECTURE.md) and [WEATHER_INTEGRATION.md](WEATHER_INTEGRATION.md). The table is kept for history.


| signal | weight | source |
|---|---|---|
| semantic | 0.30 | cosine similarity to the query embedding, min–max normalised in the candidate set |
| keyword | 0.10 | `ts_rank_cd` on the Russian full-text vector (non-Russian tokens pass through unstemmed) |
| affinity | 0.30 | interests ↔ category table in `app/rag/taxonomy.py` (a heuristic about our categories, never shown as a fact about a place); a default sightseeing profile when no interest is given; quiet penalises mall / sports / restaurant; "free" favours places with `fee=no` and public-space categories |
| proximity | 0.20 | `1 − distance / radius` |
| data completeness | 0.10 | share of {localised name, hours, address, contact, description} present |

With explicit interests, categories unrelated to them are dropped when at least three relevant candidates exist. The final pick is greedy with a 0.85 discount per repeated category so the three results are not near-identical (no discount when the user asks for one explicit category; places with an identical name are skipped).

Manual checks with the real index (retrieval only, `/api/ai/search`): "музей истории" → the two military-history museums first (semantic 0.98–1.00); Kazakh "саябақта серуендегім келеді" near Mega Silk Way → NU Park first; English "a quiet coffee shop" → Drinkit, «Лепим и варим» and Starbucks (all cafes within 180 m); "free + unusual + 60 min" near Mega Silk Way → radius 1292 m, only places within it; 10 minutes → no candidates, reported as such.

## Generation (`LLMService`, `RecommendationService`)

- Official `google-genai` SDK, async, structured JSON output validated with Pydantic, temperature 0 for understanding and 0.4 for the writing step, bounded output tokens, concurrency limit, timeout (`GEMINI_TIMEOUT_S`, default 30 s), one retry on 429 / 5xx, errors mapped to `not_configured | timeout | rate_limited | auth | upstream | no_model` (no provider text or key ever reaches the client or the logs).
- Model: `GEMINI_MODEL` if set; otherwise the newest `gemini-<version>-flash` that supports `generateContent` is discovered through the API at runtime, so no model name is hard-coded.
- Context size: at most 8 candidates, descriptions cut to 280 characters, the last 4 chat messages.
- If Gemini is unavailable the AI endpoints answer `503` with a code (`ai_not_configured`, `ai_timeout`, …) and the UI says so. There is no canned text. `/api/ai/search` does not need Gemini.

## Protection against hallucination

1. The LLM never supplies names, coordinates, addresses, hours, fees, distances or travel times: each card is assembled from the database record. The LLM returns only `poi_id`, `reason` and `activity_idea` (+ intro / limitations / one follow-up question).
2. Every `poi_id` must belong to the retrieved candidates. Unknown or repeated ids are dropped; if the answer is unusable the call is retried once, then the retrieval results are shown without AI text (`explanation_unavailable`).
3. Text checks: clock times, money amounts, ratings or "open now" that are not present in that candidate's facts make the answer invalid; after a retry the offending field is removed and the user is told (`ai_text_trimmed`).
4. The prompt forbids inventing facts, requires `activity_idea` to be an idea (the UI labels it "Idea · AI"), and tells the model that POI descriptions are untrusted data, not instructions. User text is passed as JSON-quoted data.
5. "Free" is only confirmed when OSM says `fee=no`; otherwise the card says "cost not stated in the source" and a notice explains it.
6. Visit duration is a category-level typical value flagged `typical_for_category`, not a claim about the place.

## Incomplete data

Missing hours → "working hours unknown", never "open now". Every card carries `confidence` (level + verified / missing fields: localised name, address, hours, contact, description) and the OSM link with ODbL attribution. Names are the stored OSM names for the selected language, falling back to the original name; they are never translated.

## Service protection

`POST /api/ai/{search,recommend,chat}`: input limits (message ≤ 1000 characters, time 5–600 min, radius 100–20000 m, enums for categories / interests), per-IP limit (`AI_RATE_LIMIT_PER_MIN`, default 12/min → `429` + `Retry-After`), identical requests in flight or within 8 s share one result (double tap = one Gemini call; verified: 3 parallel identical requests → 1 understanding + 1 generation call), logs contain only language, message length, counts and timings (verified: no message text or coordinates in the logs).

## Stage 6 additions

- **Weather in recommendations.** `use_weather` on `/api/ai/search | recommend | chat` adds the Open-Meteo assessment of the start point to the existing `weather` score; the answer returns the assessment, and the prompt gets a `WEATHER` line with the rule that shelter or weather details not in it must never be claimed.
- **Explained by source.** `explanation.mood` and `explanation.weather_fit` (`indoor_in_adverse_weather` / `outdoor_in_good_weather`, category-level) next to `matched_interests[].source` let the UI say what came from the mood, the weather and the user's interests. The prompt now also says that a mood is a wish, not a property of a place (never "quiet", "romantic", "uncrowded").
- **Atmosphere from the text** (`romantic`, `family`, `quiet`) ranks as a request interest (before, only `quiet` had an effect). Time stated in the message now beats the time of the walk context.
- **Shared context.** `RecommendationContext` + `services/context.py` (start point, weather, PersonalContext) are used by the map layer, Surprise Me, AI Quest and Group Harmony; all of them call the same `retrieve` — no second recommendation mechanism. See [ADVANCED_AI_FEATURES.md](ADVANCED_AI_FEATURES.md).
- **Name search without the LLM.** `GET /api/pois/suggest` ranks exact, prefix, substring and pg_trgm-similar names (`similarity` / `word_similarity` ≥ 0.3), so ordinary lookups in the map search never cost a Gemini call.

## Verification status

- Verified with the real stack: embedding model, index (1030 / 0 failed, re-run skips all), retrieval in ru / kk / en, filters, time and radius logic, validation errors, rate limit, double submit, privacy of logs, error mapping against the real Gemini endpoint with an invalid key (`ai_auth`).
- Verified with a **local stand-in for the Gemini REST API** (test harness, not part of the product): the SDK request/response plumbing, model discovery, structured parsing, session merge ("no museums" / "something else"), anchor resolution from text, id and text validation, and the whole UI flow. This proves the integration code, **not** the quality of real Gemini answers.
- **Not verified: a real Gemini call with a valid key** (none was available). Set `GEMINI_API_KEY` in `.env` and try the headline scenario to confirm.
