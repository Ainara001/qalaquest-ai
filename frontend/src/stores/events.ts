import { create } from "zustand";
import { ApiError } from "@/services/api";
import { fetchEvents, type EventCategory, type EventsResponse, type EventWhen } from "@/services/events";
import { useExplore } from "@/stores/explore";

/** Events layer: real dated events from verified sources only. Empty when no source is connected (said in the UI). */
interface EventsState {
  when: EventWhen;
  categories: EventCategory[];
  status: "idle" | "loading" | "ok" | "error";
  errorCode: string | null;
  data: EventsResponse | null;
  setWhen: (w: EventWhen) => void;
  toggleCategory: (c: EventCategory) => void;
  load: () => Promise<void>;
}

let ctrl: AbortController | null = null;

export const useEvents = create<EventsState>((set, get) => ({
  when: "today",
  categories: [],
  status: "idle",
  errorCode: null,
  data: null,
  setWhen: (when) => {
    set({ when });
    void get().load();
  },
  toggleCategory: (c) => {
    const cur = get().categories;
    set({ categories: cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c] });
    void get().load();
  },
  load: async () => {
    ctrl?.abort();
    ctrl = new AbortController();
    set({ status: "loading", errorCode: null });
    try {
      const data = await fetchEvents(get().when, get().categories, useExplore.getState().origin, ctrl.signal);
      set({ status: "ok", data });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      set({ status: "error", errorCode: e instanceof ApiError ? (e.code ?? (e.status === 0 ? "backend" : "generic")) : "generic" });
    }
  },
}));
