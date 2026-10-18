import { create } from "zustand";
import i18n from "@/i18n";
import { ApiError } from "@/services/api";
import { generateQuest, type Quest, type QuestType } from "@/services/advanced";
import { useWalkContext } from "@/stores/context";
import { useExplore } from "@/stores/explore";
import { personalizationPayload } from "@/stores/profile";

/**
 * Current AI quest and its progress. Held on the client (sessionStorage), like the walk: the server generates the
 * quest statelessly. The user confirms each task; nothing is detected automatically.
 */
export type TaskStatus = "pending" | "active" | "completed" | "skipped";

interface Stored {
  v: 1;
  quest: Quest | null;
  progress: Record<string, TaskStatus>;
  started: boolean;
}

const KEY = "qq-quest-v1";

function load(): Stored {
  try {
    const d = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Stored | null;
    if (d && d.v === 1) return d;
  } catch {
    /* ignore */
  }
  return { v: 1, quest: null, progress: {}, started: false };
}

function persist(s: Stored) {
  try {
    if (s.quest) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

interface QuestState extends Stored {
  status: "idle" | "loading" | "error";
  errorCode: string | null;
  generate: (type: QuestType, tasksCount: number) => Promise<void>;
  start: () => void;
  complete: (taskId: string) => void;
  skip: (taskId: string) => void;
  abandon: () => void;
}

let ctrl: AbortController | null = null;

/** Mark a task and make the next pending one active. */
function advance(progress: Record<string, TaskStatus>, quest: Quest, taskId: string, to: TaskStatus): Record<string, TaskStatus> {
  const next = { ...progress, [taskId]: to };
  if (!Object.values(next).includes("active")) {
    const pending = quest.tasks.find((t) => next[t.id] === "pending");
    if (pending) next[pending.id] = "active";
  }
  return next;
}

export const useQuest = create<QuestState>((set, get) => {
  const update = (patch: Partial<Stored>) => {
    set(patch);
    const s = get();
    persist({ v: 1, quest: s.quest, progress: s.progress, started: s.started });
  };
  return {
    ...load(),
    status: "idle",
    errorCode: null,

    generate: async (type, tasksCount) => {
      ctrl?.abort();
      ctrl = new AbortController();
      const c = useWalkContext.getState();
      const e = useExplore.getState();
      set({ status: "loading", errorCode: null });
      try {
        const q = await generateQuest(
          {
            lang: i18n.language === "kk" ? "kk" : "ru",
            quest_type: type,
            tasks_count: tasksCount,
            ...(e.origin ? { location: { latitude: e.origin.lat, longitude: e.origin.lon } } : {}),
            ...(c.timeMinutes ? { time_minutes: c.timeMinutes } : {}),
            use_weather: c.useWeather,
            personalization: personalizationPayload(),
          },
          ctrl.signal,
        );
        set({ status: "idle" });
        update({ quest: q, progress: Object.fromEntries(q.tasks.map((t) => [t.id, "pending" as TaskStatus])), started: false });
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        const code = err instanceof ApiError ? (err.code ?? (err.status === 0 ? "backend" : err.status === 429 ? "rate" : "generic")) : "generic";
        set({ status: "error", errorCode: code });
      }
    },
    start: () => {
      const q = get().quest;
      if (!q || !q.tasks.length) return;
      const progress = { ...get().progress };
      const first = q.tasks.find((t) => progress[t.id] === "pending");
      if (first) progress[first.id] = "active";
      update({ started: true, progress });
    },
    complete: (taskId) => {
      const q = get().quest;
      if (q) update({ progress: advance(get().progress, q, taskId, "completed") });
    },
    skip: (taskId) => {
      const q = get().quest;
      if (q) update({ progress: advance(get().progress, q, taskId, "skipped") });
    },
    abandon: () => {
      ctrl?.abort();
      set({ status: "idle", errorCode: null });
      update({ quest: null, progress: {}, started: false });
    },
  };
});

export function questDone(s: Pick<QuestState, "quest" | "progress">): number {
  return s.quest ? s.quest.tasks.filter((t) => s.progress[t.id] === "completed").length : 0;
}
export function questFinished(s: Pick<QuestState, "quest" | "progress">): boolean {
  return !!s.quest && s.quest.tasks.length > 0 && s.quest.tasks.every((t) => ["completed", "skipped"].includes(s.progress[t.id]));
}
