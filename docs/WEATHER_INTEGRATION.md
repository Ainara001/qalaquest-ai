# Astana Weather Mode (stage 5)

## Source

**Open-Meteo** forecast API (`api.open-meteo.com/v1/forecast`), no key, CC BY 4.0 (attribution shown in the UI). Requested for the user's point (or Astana centre) with `timezone=Asia/Almaty` — the response carries `utc_offset_seconds = 18000` (UTC+5, Astana's current offset) and the UI shows local times.

Fields used:
- current: `temperature_2m`, `apparent_temperature`, `wind_speed_10m`, `wind_gusts_10m` (m/s), `precipitation`, `weather_code` (WMO → clear / partly cloudy / cloudy / fog / drizzle / rain / snow / thunderstorm);
- hourly for the next 12 h: the same plus `precipitation_probability`.

Current values are labelled as current (with their observation time); forecast values are only used for the walk window and labelled as forecast; missing values stay `null`.

## Service (`backend/app/services/weather.py`)

- In-memory cache per ~5 km grid cell for 10 min (`WEATHER_CACHE_S`), so neighbours and repeated plans share one request.
- 8 s timeout, one retry after 1.5 s on 429/5xx (Open-Meteo answered "service overloaded" 503 once during development).
- If a refresh fails, data up to 1 h old is served with `stale: true`; otherwise `WeatherUnavailable` → `503 weather_unavailable` from the API, and routes are planned **without** weather adaptation with an explicit notice. Values are never invented.
- Endpoints: `GET /api/weather/current?latitude&longitude`, `GET /api/weather/forecast?latitude&longitude&minutes=90` (assessment for that walk window).

## Comfort rules (`backend/app/core/weather_rules.py`, override with `WEATHER_RULES` JSON)

| Condition | Default threshold (walk window: current + forecast hours) | Suggested outdoor limit |
|---|---|---|
| windy | wind ≥ 10 m/s or gusts ≥ 15 m/s | 30 min |
| cold | feels-like ≤ −5 °C | 30 min |
| very_cold | feels-like ≤ −15 °C | 15 min |
| hot | feels-like ≥ 30 °C | 40 min |
| wet | precipitation probability ≥ 60 % or ≥ 0.3 mm/h | 20 min |

Level: `comfortable`, `caution` (one condition), `indoor_preferred` (very cold, wet, or two conditions). These are QalaQuest's walking-comfort heuristics, **not official warnings** (Kazhydromet warnings are not integrated); the UI says so.

## Effect on recommendations and routes

- **Ranking** (stage 3/4 retrieval): a `weather` score with weight 0.10 — in adverse weather categories that are usually indoors (museum, theatre, library, gallery, mall, café, restaurant) get 1.0, usually-outdoor ones (park, monument, viewpoint, square, promenade, playground, architecture) 0.2; in comfortable weather outdoor 0.9, indoor 0.6. This is a property of the category, never a claim about a specific building or about wind shelter.
- **Map and AI recommendations (stage 6):** `/api/ai/search`, `/recommend` and `/chat` accept `use_weather=true`; the assessment for the start point (or the city centre, reported) is applied with the same score and returned as `weather`. Each card says whether the weather favoured it: `explanation.weather_fit` = `indoor_in_adverse_weather` or `outdoor_in_good_weather` (category-level), so the UI can separate "because of your mood", "because of the weather" and "because of your interests".
- **Routes:** the outdoor limit becomes a hard constraint on `walking + visits at usually-outdoor places (+ half of unknown ones)`; if nothing fits, the limit is relaxed and the user is told.
- Verified with real data: the forecast for Astana (10.5 °C, wind 3.1 m/s, 0 % precipitation) is "comfortable", so no adaptation happened. To prove the mechanism, the wind threshold was lowered by configuration to 2.5 m/s: the 90-minute plan changed from monument + square + attraction (≈71 min outdoors) to monument + gallery (≈22 min outdoors), with notice `weather_cap_applied (30)`.

## Accuracy limits

- Model data on a ~5 km grid; no street-level wind exposure, no sheltered-route information — the app never says a route is protected from wind.
- Indoor/outdoor is category-level (OSM rarely has building/indoor tags).
- Forecast probability is not a guarantee; the comfort thresholds are configurable defaults, not standards.
