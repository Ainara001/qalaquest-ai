import { create } from "zustand";
import i18n from "@/i18n";
import { ApiError } from "@/services/api";
import { planRoute, replanRoute, type Route, type RouteChange, type RouteEvent, type SessionPrefs, type SessionUpdate, type StartPoint } from "@/services/routes";
import { useWalkContext } from "@/stores/context";
import { personalizationPayload } from "@/stores/profile";

/**
 * Active walk (RouteSession) held on the client. Kept in sessionStorage so a language switch, tab change or
 * reload keeps the walk; only the start and the latest known point are stored, never a movement history.
 *
 * Stage 6: every re-plan sends the CURRENT walk context (mood, budget, company, weather switch from the map), and a
 * change requested by the user ("less walking", "go indoors", a new mood…) comes back as a PROPOSAL: the current route
 * stays until the user confirms the new one. Progress marks ("I visited", "skip") apply at once.
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

/** A re-planned route that the user has not accepted yet. */
export interface Proposal {
  event: RouteEvent;
  route: Route;
  change: RouteChange;
  update: SessionUpdate;
  remaining: number; // remaining minutes when it was computed
}

// progress marks apply immediately; everything else is a proposal to confirm
const APPLY_AT_ONCE: RouteEvent["type"][] = ["visited", "skip"];

interface WalkState {
  session: WalkSession | null;
  proposal: Proposal | null;
  draft: Route | null; // a planned route not started yet
  draftStart: StartPoint | null;
  draftBudget: number;
  pending: boolean;
  error: string | null;
  plan: (p: { start: StartPoint; time_minutes: number; poi_ids?: number[]; places_count?: number }) => Promise<void>;
  start: () => void;
  replan: (event: RouteEvent) => Promise<boolean>;
  applyProposal: () => void;
  rejectProposal: () => void;
  finish: () => void;
  discardDraft: () => void;
  setDraft: (route: Route, start: StartPoint, budget: number) => void;
  clearError: () => void;
}

let ctrl: AbortController | null = null;

/** Make a computed re-plan the current walk. */
function apply(p: Proposal) {
  const s = useWalk.getState().session;
  if (!s) return;
  const u = p.update;
  if (u.finished) {
    save(null);
    useWalk.setState({ session: null, proposal: null });
    return;
  }
  const next: WalkSession = {
    ...s, version: u.version, current: u.current, stops: u.stops, visited: u.visited, skipped: u.skipped, rejected: u.rejected,
    prefs: u.prefs, route: p.route, change: p.change, finished: u.finished,
    budget: u.remaining_min !== null && u.remaining_min !== p.remaining ? { minutes: u.remaining_min, at: Date.now() } : s.budget,
  };
  save(next);
  useWalk.setState({ session: next, proposal: null });
}
const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

export const useWalk = create<WalkState>((set, get) => ({
  session: load(),
  proposal: null,
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
        {
          lang: i18n.language, start, time_minutes, ...(poi_ids?.length ? { poi_ids } : {}), ...(places_count ? { places_count } : {}),
          use_weather: useWalkContext.getState().useWeather, personalization: personalizationPayload(),
        },
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
      budget: { minutes: draftBudget, at: Date.now() }, prefs: { ...EMPTY_PREFS, mood: useWalkContext.getState().mood }, route: draft,
      change: null, finished: false,
    };
    save(s);
    set({ session: s, draft: null, proposal: null });
  },

  replan: async (event) => {
    const s = get().session;
    if (!s || get().pending) return false;
    ctrl?.abort();
    ctrl = new AbortController();
    set({ pending: true, error: null, proposal: null });
    const remaining = remainingMinutes(s);
    const ctx = useWalkContext.getState();
    // the walk always uses today's mood from the shared context (map / AI guide), never a stale copy
    const prefs = { ...s.prefs, mood: event.type === "mood" ? (event.mood ?? null) : ctx.mood };
    try {
      const res = await replanRoute(
        {
          lang: i18n.language,
          session: {
            id: s.id, version: s.version, started_at: s.started_at, start: s.start, current: s.current, stops: s.stops,
            visited: s.visited, skipped: s.skipped, rejected: s.rejected, time_budget_min: s.time_budget_min,
            remaining_min: remaining, prefs,
            last_total_minutes: s.route.totals?.total_minutes ?? null, last_distance_m: s.route.totals?.walk_distance_m ?? null,
          },
          event,
          use_weather: ctx.useWeather,
          personalization: personalizationPayload(),
        },
        ctrl.signal,
      );
      const proposal: Proposal = { event, route: res.route, change: res.change, update: res.session, remaining };
      if (APPLY_AT_ONCE.includes(event.type)) apply(proposal);
      else set({ proposal });
      return true;
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") set({ error: errorCode(e) });
      return false;
    } finally {
      set({ pending: false });
    }
  },

  applyProposal: () => {
    const p = get().proposal;
    if (p) apply(p);
  },
  rejectProposal: () => set({ proposal: null }),

  finish: () => {
    ctrl?.abort();
    save(null);
    set({ session: null, draft: null, proposal: null, pending: false, error: null });
  },
  discardDraft: () => set({ draft: null }),
  // a route computed elsewhere (group walk) becomes the draft the user can start
  setDraft: (route, start, budget) => set({ draft: route, draftStart: start, draftBudget: budget, error: null }),
  clearError: () => set({ error: null }),
}));
