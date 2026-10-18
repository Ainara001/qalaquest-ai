import { create } from "zustand";
import { sessionPayload } from "@/stores/context";

// The mood belongs to the current walk (stores/context.ts), not to the persistent profile.
export { MOODS, type Mood } from "@/stores/context";

/**
 * Guest profile. Lives on this device only: in memory, and in localStorage only after the user allows it.
 * No account, no server copy. Feedback is a list of POI ids per action; the server derives all weights.
 */
export type ProfileInterest =
  | "architecture" | "history" | "art" | "nature" | "parks" | "photo" | "coffee" | "food" | "museums"
  | "unusual" | "family" | "sport" | "quiet" | "active" | "culture_events" | "free";
export const PROFILE_INTERESTS: ProfileInterest[] = [
  "architecture", "history", "art", "nature", "parks", "photo", "coffee", "food",
  "museums", "unusual", "family", "sport", "quiet", "active", "culture_events", "free",
];
export type Budget = "free" | "2000" | "5000" | "10000" | "any";
export type Pace = "slow" | "normal" | "active";
export type Setting = "indoor" | "outdoor" | "any";
export type FeedbackKind = "liked" | "more_like" | "not_interested" | "visited" | "never" | "saved";
export const FEEDBACK_KINDS: FeedbackKind[] = ["liked", "saved", "more_like", "visited", "not_interested", "never"];

export interface Preferences {
  interests: ProfileInterest[];
  favorite_categories: string[];
  disliked_categories: string[];
  pace: Pace;
  budget: Budget;
  walk_duration_min: number | null;
  max_walk_m: number | null;
  setting: Setting;
  places_count: 1 | 2 | 3;
  with_children: boolean;
  wheelchair: boolean;
}

export type Feedback = Record<FeedbackKind, number[]>;
export interface PlaceRef {
  name: string | null;
  category: string;
}

export const DEFAULT_PREFS: Preferences = {
  interests: [], favorite_categories: [], disliked_categories: [], pace: "normal", budget: "any",
  walk_duration_min: null, max_walk_m: null, setting: "any", places_count: 3, with_children: false, wheelchair: false,
};
const EMPTY_FEEDBACK: Feedback = { liked: [], more_like: [], not_interested: [], visited: [], never: [], saved: [] };
const KEY = "qq-profile-v1";
const MAX_IDS = 300;
// mutually exclusive opinions about the same place
const OPPOSITE: Partial<Record<FeedbackKind, FeedbackKind[]>> = {
  liked: ["not_interested", "never"], more_like: ["not_interested", "never"],
  not_interested: ["liked", "more_like"], never: ["liked", "more_like", "saved"], saved: ["never"],
};

interface Stored {
  v: 1;
  prefs: Preferences;
  feedback: Feedback;
  places: Record<number, PlaceRef>;
  personalize: boolean | null;
}

function load(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Stored;
    if (d.v !== 1) return null;
    return { ...d, prefs: { ...DEFAULT_PREFS, ...d.prefs }, feedback: { ...EMPTY_FEEDBACK, ...d.feedback } };
  } catch {
    return null;
  }
}

interface ProfileState {
  storeOnDevice: boolean;
  prefs: Preferences;
  feedback: Feedback;
  places: Record<number, PlaceRef>; // names of rated places, for the saved/visited lists
  personalize: boolean | null; // null = default: on when the profile is configured
  setStoreOnDevice: (on: boolean) => void;
  setPrefs: (patch: Partial<Preferences>) => void;
  toggleInterest: (i: ProfileInterest) => void;
  cycleCategory: (c: string) => void;
  setPersonalize: (on: boolean) => void;
  toggleFeedback: (id: number, kind: FeedbackKind, place: PlaceRef) => void;
  clearFeedback: () => void;
  resetPrefs: () => void;
  eraseAll: () => void;
}

const saved = load();

function persist(s: ProfileState) {
  try {
    if (!s.storeOnDevice) return;
    const data: Stored = { v: 1, prefs: s.prefs, feedback: s.feedback, places: s.places, personalize: s.personalize };
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable: keep working in memory */
  }
}

export const useProfile = create<ProfileState>((set, get) => {
  const update = (patch: Partial<ProfileState>) => {
    set(patch);
    persist(get());
  };
  return {
    storeOnDevice: saved !== null,
    prefs: saved?.prefs ?? DEFAULT_PREFS,
    feedback: saved?.feedback ?? EMPTY_FEEDBACK,
    places: saved?.places ?? {},
    personalize: saved?.personalize ?? null,

    setStoreOnDevice: (on) => {
      set({ storeOnDevice: on });
      if (on) persist(get());
      else {
        try {
          localStorage.removeItem(KEY);
        } catch {
          /* ignore */
        }
      }
    },
    setPrefs: (patch) => update({ prefs: { ...get().prefs, ...patch } }),
    toggleInterest: (i) => {
      const cur = get().prefs.interests;
      update({ prefs: { ...get().prefs, interests: cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i] } });
    },
    // neutral -> favourite -> avoid -> neutral
    cycleCategory: (c) => {
      const p = get().prefs;
      const fav = p.favorite_categories.includes(c);
      const dis = p.disliked_categories.includes(c);
      update({
        prefs: {
          ...p,
          favorite_categories: fav ? p.favorite_categories.filter((x) => x !== c) : dis ? p.favorite_categories : [...p.favorite_categories, c],
          disliked_categories: fav ? [...p.disliked_categories, c] : p.disliked_categories.filter((x) => x !== c),
        },
      });
    },
    setPersonalize: (on) => update({ personalize: on }),
    toggleFeedback: (id, kind, place) => {
      const fb = { ...get().feedback };
      const on = fb[kind].includes(id);
      fb[kind] = on ? fb[kind].filter((x) => x !== id) : [id, ...fb[kind]].slice(0, MAX_IDS);
      if (!on) for (const o of OPPOSITE[kind] ?? []) fb[o] = fb[o].filter((x) => x !== id);
      update({ feedback: fb, places: { ...get().places, [id]: place } });
    },
    clearFeedback: () => update({ feedback: EMPTY_FEEDBACK, places: {} }),
    resetPrefs: () => update({ prefs: DEFAULT_PREFS, personalize: null }),
    eraseAll: () => {
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* ignore */
      }
      set({ prefs: DEFAULT_PREFS, feedback: EMPTY_FEEDBACK, places: {}, personalize: null, storeOnDevice: false });
    },
  };
});

export function isConfigured(p: Preferences): boolean {
  return JSON.stringify(p) !== JSON.stringify(DEFAULT_PREFS);
}

/** Whether the saved profile should be used right now (explicit switch, else on when configured). */
export function personalizationOn(s: Pick<ProfileState, "personalize" | "prefs" | "feedback">): boolean {
  const hasFeedback = Object.values(s.feedback).some((l) => l.length > 0);
  return s.personalize ?? (isConfigured(s.prefs) || hasFeedback);
}

/**
 * Payload for the backend. Only validated, documented fields; no weights.
 * `session` = today's conditions from the shared walk context (mood, time, budget, company, AI wishes) + one-off extras,
 * so the map, the AI guide and Living Route always send the same context.
 */
export function personalizationPayload(extra?: { company?: string; allow_unconfirmed_free?: boolean; time_minutes?: number; mood?: string | null }) {
  const s = useProfile.getState();
  const on = personalizationOn(s);
  const { wheelchair, ...profile } = s.prefs;
  const session: Record<string, unknown> = { ...sessionPayload(), ...(extra ?? {}) };
  if (session.mood === null) delete session.mood;
  return {
    use_profile: on,
    ...(on ? { profile, feedback: s.feedback } : { feedback: { ...EMPTY_FEEDBACK, never: s.feedback.never } }),
    ...(Object.keys(session).length ? { session } : {}),
    wheelchair, // an accessibility need is a requirement, sent even when personalization is off
  };
}
