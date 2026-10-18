import { create } from "zustand";
import i18n from "@/i18n";
import { ApiError } from "@/services/api";
import { recommendGroup, type GroupMemberInput, type GroupResponse } from "@/services/advanced";
import { useWalkContext } from "@/stores/context";
import { useExplore } from "@/stores/explore";
import { useProfile } from "@/stores/profile";

/**
 * Group Harmony: 2–5 participants entered on this device for the current session (no accounts, no invitations).
 * Kept in sessionStorage; only sent with the request.
 */
const KEY = "qq-group-v1";
export const MAX_MEMBERS = 5;

const blank = (): GroupMemberInput => ({ name: "", interests: [], mood: null, budget: null, time_minutes: null, pace: null, wheelchair: false, with_children: false });

function load(): GroupMemberInput[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (Array.isArray(v) && v.length >= 2 && v.length <= MAX_MEMBERS) return v.map((m) => ({ ...blank(), ...m }));
  } catch {
    /* ignore */
  }
  return [blank(), blank()];
}

interface GroupState {
  members: GroupMemberInput[];
  status: "idle" | "loading" | "error";
  errorCode: string | null;
  result: GroupResponse | null;
  update: (i: number, patch: Partial<GroupMemberInput>) => void;
  add: () => void;
  remove: (i: number) => void;
  recommend: () => Promise<void>;
  clearResult: () => void;
}

let ctrl: AbortController | null = null;

export const useGroup = create<GroupState>((set, get) => {
  const save = (members: GroupMemberInput[]) => {
    set({ members });
    try {
      sessionStorage.setItem(KEY, JSON.stringify(members));
    } catch {
      /* storage unavailable */
    }
  };
  return {
    members: load(),
    status: "idle",
    errorCode: null,
    result: null,
    update: (i, patch) => save(get().members.map((m, k) => (k === i ? { ...m, ...patch } : m))),
    add: () => get().members.length < MAX_MEMBERS && save([...get().members, blank()]),
    remove: (i) => get().members.length > 2 && save(get().members.filter((_, k) => k !== i)),
    clearResult: () => set({ result: null, status: "idle", errorCode: null }),
    recommend: async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      const c = useWalkContext.getState();
      const e = useExplore.getState();
      set({ status: "loading", errorCode: null });
      try {
        const r = await recommendGroup(
          {
            lang: i18n.language === "kk" ? "kk" : "ru",
            members: get().members.map((m) => ({
              ...(m.name.trim() ? { name: m.name.trim().slice(0, 30) } : {}),
              interests: m.interests.slice(0, 8),
              ...(m.mood ? { mood: m.mood } : {}),
              ...(m.budget ? { budget: m.budget } : {}),
              ...(m.time_minutes ? { time_minutes: m.time_minutes } : {}),
              ...(m.pace ? { pace: m.pace } : {}),
              wheelchair: m.wheelchair,
              with_children: m.with_children,
            })),
            places_count: 3,
            ...(e.origin ? { location: { latitude: e.origin.lat, longitude: e.origin.lon } } : {}),
            ...(e.categories.length ? { categories: e.categories } : {}),
            use_weather: c.useWeather,
            // the device owner's "never again" places and accessibility need still apply; their personal taste does not
            personalization: { use_profile: false, feedback: { never: useProfile.getState().feedback.never }, wheelchair: useProfile.getState().prefs.wheelchair },
          },
          ctrl.signal,
        );
        set({ status: "idle", result: r });
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        const code = err instanceof ApiError ? (err.code ?? (err.status === 0 ? "backend" : err.status === 429 ? "rate" : "generic")) : "generic";
        set({ status: "error", errorCode: code });
      }
    },
  };
});
