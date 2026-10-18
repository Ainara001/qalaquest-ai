import { create } from "zustand";

/**
 * Current-walk context shared by the map, the AI guide and Living Route (stage 6).
 *
 * These are today's conditions, not the persistent profile: they live in sessionStorage (this tab only), so a tab
 * switch, a language switch or a reload keeps them, and closing the tab forgets them. Nothing here is sent to the
 * server except as part of a request. The persistent profile stays in `stores/profile.ts`.
 */
export type Mood = "relax" | "adventure" | "romantic" | "photo" | "learn" | "active" | "family" | "unusual" | "just_walk";
// order of the mood picker (stage 6 list)
export const MOODS: Mood[] = ["relax", "adventure", "romantic", "photo", "learn", "active", "family", "unusual", "just_walk"];

export type SessionBudget = "free" | "2000" | "5000" | "10000";
export const TIME_OPTIONS = [30, 60, 90, 120, 180] as const;
export const RADIUS_OPTIONS = [1, 2, 3, 5] as const;

/** Wishes the AI guide understood from the chat text; shown on the map as a removable chip. */
export interface AiWishes {
  interests: string[];
  exclude_categories: string[];
}

interface Stored {
  v: 1;
  mood: Mood | null;
  timeMinutes: number | null;
  budget: SessionBudget | null;
  allowUnconfirmedFree: boolean;
  withChildren: boolean;
  useWeather: boolean;
  recLayer: boolean;
  aiWishes: AiWishes;
}

const KEY = "qq-context-v1";
const NO_WISHES: AiWishes = { interests: [], exclude_categories: [] };
const DEFAULTS: Stored = {
  v: 1, mood: null, timeMinutes: null, budget: null, allowUnconfirmedFree: false, withChildren: false,
  useWeather: true, recLayer: true, aiWishes: NO_WISHES,
};

function load(): Stored {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const d = JSON.parse(raw) as Stored;
    if (d.v !== 1) return DEFAULTS;
    // a mood saved by an older version that is no longer offered is dropped instead of being sent
    return { ...DEFAULTS, ...d, mood: d.mood && MOODS.includes(d.mood) ? d.mood : null };
  } catch {
    return DEFAULTS;
  }
}

interface ContextState extends Stored {
  setMood: (m: Mood | null) => void;
  setTime: (min: number | null) => void;
  setBudget: (b: SessionBudget | null) => void;
  setAllowUnconfirmedFree: (on: boolean) => void;
  setWithChildren: (on: boolean) => void;
  setUseWeather: (on: boolean) => void;
  setRecLayer: (on: boolean) => void;
  setAiWishes: (w: AiWishes) => void;
  clearAiWishes: () => void;
  resetFilters: () => void;
}

export const useWalkContext = create<ContextState>((set, get) => {
  const update = (patch: Partial<Stored>) => {
    set(patch);
    const s = get();
    const data: Stored = {
      v: 1, mood: s.mood, timeMinutes: s.timeMinutes, budget: s.budget, allowUnconfirmedFree: s.allowUnconfirmedFree,
      withChildren: s.withChildren, useWeather: s.useWeather, recLayer: s.recLayer, aiWishes: s.aiWishes,
    };
    try {
      sessionStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* storage unavailable: keep working in memory */
    }
  };
  return {
    ...load(),
    setMood: (mood) => update({ mood }),
    setTime: (timeMinutes) => update({ timeMinutes }),
    setBudget: (budget) => update({ budget, allowUnconfirmedFree: budget === "free" ? get().allowUnconfirmedFree : false }),
    setAllowUnconfirmedFree: (allowUnconfirmedFree) => update({ allowUnconfirmedFree }),
    setWithChildren: (withChildren) => update({ withChildren }),
    setUseWeather: (useWeather) => update({ useWeather }),
    setRecLayer: (recLayer) => update({ recLayer }),
    setAiWishes: (aiWishes) => update({ aiWishes }),
    clearAiWishes: () => update({ aiWishes: NO_WISHES }),
    resetFilters: () => update({ mood: null, timeMinutes: null, budget: null, allowUnconfirmedFree: false, withChildren: false, aiWishes: NO_WISHES }),
  };
});

/** Today's conditions in the shape of the backend `personalization.session` (SessionPreferences). */
export function sessionPayload(): Record<string, unknown> {
  const c = useWalkContext.getState();
  return {
    ...(c.mood ? { mood: c.mood } : {}),
    ...(c.timeMinutes ? { time_minutes: c.timeMinutes } : {}),
    ...(c.budget ? { budget: c.budget } : {}),
    ...(c.budget === "free" && c.allowUnconfirmedFree ? { allow_unconfirmed_free: true } : {}),
    ...(c.withChildren ? { company: "family" } : {}),
    ...(c.aiWishes.interests.length ? { interests: c.aiWishes.interests.slice(0, 8) } : {}),
    ...(c.aiWishes.exclude_categories.length ? { exclude_categories: c.aiWishes.exclude_categories.slice(0, 16) } : {}),
  };
}
