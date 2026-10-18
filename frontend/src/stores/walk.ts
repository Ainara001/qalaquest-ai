import { create } from "zustand";
import i18n from "@/i18n";
import { ApiError } from "@/services/api";
import { planRoute, replanRoute, type Route, type RouteChange, type RouteEvent, type SessionPrefs, type StartPoint } from "@/services/routes";
import { personalizationPayload } from "@/stores/profile";

/**
 * Active walk (RouteSession) held on the client. Kept in sessionStorage so a language switch, tab change or
 * reload keeps the walk; only the start and the latest known point are stored, never a movement history.
 */
export interface WalkSession {
  id: string;
  version: number;
  started_at: string;
  start: StartPoint;
  current: StartPoint | null;
  stops: number[];
  visited: number[];
  skipped: number[];
  rejected: number[];
  time_budget_min: number;
  budget: { minutes: number; at: number }; // remaining minutes at a moment (ms) → remaining now = minutes - elapsed
  prefs: SessionPrefs;
  route: Route;
  change: RouteChange | null;
  finished: boolean;
}

const KEY = "qq-walk-v1";
const EMPTY_PREFS: SessionPrefs = { less_walking: false, indoor: false, mood: null, interests: [], exclude_categories: [] };

function load(): WalkSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as WalkSession) : null;
  } catch {
    return null;
  }
}
function save(s: WalkSession | null) {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

export function remainingMinutes(s: WalkSession): number {
  return Math.max(0, Math.round(s.budget.minutes - (Date.now() - s.budget.at) / 60000));
}

const errorCode = (e: unknown) =>
  e instanceof ApiError ? (e.code ?? (e.status === 0 ? "backend" : e.status === 429 ? "rate" : "generic")) : "generic";

interface WalkState {
  session: WalkSession | null;
  draft: Route | null; // a planned route not started yet
  draftStart: StartPoint | null;
  draftBudget: number;
  pending: boolean;
  error: string | null;
  plan: (p: { start: StartPoint; time_minutes: number; poi_ids?: number[]; places_count?: number }) => Promise<void>;
  start: () => void;
  replan: (event: RouteEvent) => Promise<boolean>;
  finish: () => void;
  discardDraft: () => void;
  clearError: () => void;
}

let ctrl: AbortController | null = null;
const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

export const useWalk = create<WalkState>((set, get) => ({
  session: load(),
  draft: null,
  draftStart: null,
  draftBudget: 60,
  pending: false,
  error: null,

  plan: async ({ start, time_minutes, poi_ids, places_count }) => {
    if (get().pending) return;
    ctrl?.abort();
    ctrl = new AbortController();
    set({ pending: true, error: null });
    try {
      const { route } = await planRoute(
        { lang: i18n.language, start, time_minutes, ...(poi_ids?.length ? { poi_ids } : {}), ...(places_count ? { places_count } : {}), personalization: personalizationPayload() },
        ctrl.signal,
      );
      set({ draft: route, draftStart: start, draftBudget: time_minutes });
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") set({ error: errorCode(e) });
    } finally {
      set({ pending: false });
    }
  },

  start: () => {
    const { draft, draftStart, draftBudget } = get();
    if (!draft || !draftStart || !draft.stops.length) return;
    const s: WalkSession = {
      id: uid(), version: 1, started_at: new Date().toISOString(), start: draftStart, current: null,
      stops: draft.stops.map((x) => x.poi_id), visited: [], skipped: [], rejected: [], time_budget_min: draftBudget,
      budget: { minutes: draftBudget, at: Date.now() }, prefs: EMPTY_PREFS, route: draft, change: null, finished: false,
    };
    save(s);
    set({ session: s, draft: null });
  },

  replan: async (event) => {
    const s = get().session;
    if (!s || get().pending) return false;
    ctrl?.abort();
    ctrl = new AbortController();
    set({ pending: true, error: null });
    const remaining = remainingMinutes(s);
    try {
      const res = await replanRoute(
        {
          lang: i18n.language,
          session: {
            id: s.id, version: s.version, started_at: s.started_at, start: s.start, current: s.current, stops: s.stops,
            visited: s.visited, skipped: s.skipped, rejected: s.rejected, time_budget_min: s.time_budget_min,
            remaining_min: remaining, prefs: s.prefs,
            last_total_minutes: s.route.totals?.total_minutes ?? null, last_distance_m: s.route.totals?.walk_distance_m ?? null,
          },
          event,
          personalization: personalizationPayload(),
        },
        ctrl.signal,
      );
      const u = res.session;
      const next: WalkSession = {
        ...s, version: u.version, current: u.current, stops: u.stops, visited: u.visited, skipped: u.skipped, rejected: u.rejected,
        prefs: u.prefs, route: res.route, change: res.change, finished: u.finished,
        budget: u.remaining_min !== null && u.remaining_min !== remaining ? { minutes: u.remaining_min, at: Date.now() } : s.budget,
      };
      save(next);
      set({ session: next });
      return true;
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") set({ error: errorCode(e) });
      return false;
    } finally {
      set({ pending: false });
    }
  },

  finish: () => {
    ctrl?.abort();
    save(null);
    set({ session: null, draft: null, pending: false, error: null });
  },
  discardDraft: () => set({ draft: null }),
  clearError: () => set({ error: null }),
}));
