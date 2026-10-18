import { create } from "zustand";
import i18n from "@/i18n";
import { ApiError } from "@/services/api";
import { searchPlaces, type Notice, type Recommendation, type SearchResult } from "@/services/ai";
import type { WeatherAssessment } from "@/services/routes";
import { useWalkContext } from "@/stores/context";
import { useExplore } from "@/stores/explore";
import { personalizationPayload } from "@/stores/profile";

/**
 * Mood-aware recommendation layer of the map ("Места для вас").
 * Real POIs ranked by the backend (`/api/ai/search`: retrieval + personal ranking, no LLM) for the current walk
 * context: mood, time, budget, start point, categories, weather, profile. Kept in a store so the results survive
 * tab switches; recomputed whenever the context changes.
 */
export const REC_LIMIT = 10;
export const TOP_PINS = 3;

interface RecsState {
  status: "idle" | "loading" | "ok" | "error";
  errorCode: string | null;
  results: Recommendation[];
  notices: Notice[];
  weather: WeatherAssessment | null;
  usedLocation: SearchResult["used_location"];
  key: string;
  load: (force?: boolean) => Promise<void>;
}

let ctrl: AbortController | null = null;

/** The request for the current context (also used as the cache key). */
export function recsRequest(): Record<string, unknown> {
  const c = useWalkContext.getState();
  const e = useExplore.getState();
  return {
    lang: i18n.language === "kk" ? "kk" : "ru",
    limit: REC_LIMIT,
    ...(e.origin ? { location: { latitude: e.origin.lat, longitude: e.origin.lon }, radius_m: Math.round(e.radiusKm * 1000) } : {}),
    ...(c.timeMinutes ? { time_minutes: c.timeMinutes } : {}),
    ...(e.categories.length ? { categories: e.categories } : {}),
    use_weather: c.useWeather,
    personalization: personalizationPayload(),
  };
}

export const useRecs = create<RecsState>((set, get) => ({
  status: "idle",
  errorCode: null,
  results: [],
  notices: [],
  weather: null,
  usedLocation: null,
  key: "",
  load: async (force = false) => {
    const body = recsRequest();
    const key = JSON.stringify(body);
    if (!force && key === get().key && get().status !== "error") return;
    ctrl?.abort();
    ctrl = new AbortController();
    set({ status: "loading", key, errorCode: null });
    try {
      const r = await searchPlaces(body, ctrl.signal);
      set({ status: "ok", results: r.results, notices: r.notices, weather: r.weather ?? null, usedLocation: r.used_location });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      const code = e instanceof ApiError ? (e.code ?? (e.status === 0 ? "backend" : e.status === 429 ? "rate" : "generic")) : "generic";
      set({ status: "error", errorCode: code, results: [], notices: [] });
    }
  },
}));
