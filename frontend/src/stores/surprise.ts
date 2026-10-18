import { create } from "zustand";
import i18n from "@/i18n";
import { ApiError } from "@/services/api";
import { getSurprise, type SurpriseResponse } from "@/services/advanced";
import { useWalkContext } from "@/stores/context";
import { useExplore } from "@/stores/explore";
import { personalizationPayload } from "@/stores/profile";

/**
 * "Surprise me": one relevant place that is new for the user. The ids offered in this tab are remembered
 * (sessionStorage) and sent back, so "another option" never repeats a place.
 */
const KEY = "qq-surprise-v1";
const MAX_HISTORY = 100;

function loadHistory(): number[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => Number.isInteger(x)).slice(-MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

interface SurpriseState {
  status: "idle" | "loading" | "ok" | "error";
  result: SurpriseResponse | null;
  errorCode: string | null;
  history: number[];
  next: () => Promise<void>;
  resetHistory: () => void;
}

let ctrl: AbortController | null = null;

export const useSurprise = create<SurpriseState>((set, get) => ({
  status: "idle",
  result: null,
  errorCode: null,
  history: loadHistory(),
  next: async () => {
    ctrl?.abort();
    ctrl = new AbortController();
    const c = useWalkContext.getState();
    const e = useExplore.getState();
    set({ status: "loading", errorCode: null });
    try {
      const r = await getSurprise(
        {
          lang: i18n.language === "kk" ? "kk" : "ru",
          ...(e.origin ? { location: { latitude: e.origin.lat, longitude: e.origin.lon } } : {}),
          ...(c.timeMinutes ? { time_minutes: c.timeMinutes } : {}),
          ...(e.categories.length ? { categories: e.categories } : {}),
          use_weather: c.useWeather,
          exclude_poi_ids: get().history.slice(-MAX_HISTORY),
          personalization: personalizationPayload(),
        },
        ctrl.signal,
      );
      const history = r.place ? [...get().history, r.place.poi_id].slice(-MAX_HISTORY) : get().history;
      try {
        sessionStorage.setItem(KEY, JSON.stringify(history));
      } catch {
        /* storage unavailable */
      }
      set({ status: "ok", result: r, history });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      const code = err instanceof ApiError ? (err.code ?? (err.status === 0 ? "backend" : err.status === 429 ? "rate" : "generic")) : "generic";
      set({ status: "error", errorCode: code });
    }
  },
  resetHistory: () => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    set({ history: [] });
  },
}));
