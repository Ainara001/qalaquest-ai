import { create } from "zustand";
import i18n from "@/i18n";
import { ApiError } from "@/services/api";
import { resetChat, sendChat, type AiParams, type AiResponse, type Interest } from "@/services/ai";
import { useExplore } from "@/stores/explore";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text?: string;
  response?: AiResponse;
  errorCode?: string;
  retry?: { message: string; params: AiParams };
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
export const newSessionId = () => (crypto?.randomUUID ? crypto.randomUUID() : uid() + uid());

interface GuideState {
  messages: ChatMessage[];
  sessionId: string;
  pending: boolean;
  interests: Interest[]; // session-only hints; long-term profile arrives in stage 4
  anchor: { id: number; name: string | null } | null;
  setAnchor: (a: GuideState["anchor"]) => void;
  toggleInterest: (i: Interest) => void;
  send: (message: string, params?: AiParams) => Promise<void>;
  clear: () => void;
}

let controller: AbortController | null = null;

export const useGuide = create<GuideState>((set, get) => ({
  messages: [],
  sessionId: newSessionId(),
  pending: false,
  interests: [],
  anchor: null,
  setAnchor: (anchor) => set({ anchor }),
  toggleInterest: (i) => set((s) => ({ interests: s.interests.includes(i) ? s.interests.filter((x) => x !== i) : [...s.interests, i] })),

  send: async (raw, extra = {}) => {
    const message = raw.trim();
    const { pending, sessionId, interests, anchor } = get();
    if (!message || pending) return; // empty input and double taps do nothing
    const origin = useExplore.getState().origin;
    const params: AiParams = {
      ...(origin && !anchor ? { location: { latitude: origin.lat, longitude: origin.lon } } : {}),
      ...(anchor ? { anchor_poi_id: anchor.id } : {}),
      ...(interests.length ? { interests } : {}),
      ...extra,
    };
    set((s) => ({ pending: true, messages: [...s.messages, { id: uid(), role: "user", text: message }] }));
    controller?.abort();
    controller = new AbortController();
    try {
      const response = await sendChat({ message, lang: i18n.language, session_id: sessionId, ...params }, controller.signal);
      const picks = response.recommendations.map((r, i) => ({ id: r.poi_id, lat: r.latitude, lon: r.longitude, name: r.name, n: i + 1 }));
      useExplore.getState().setAiPicks(picks);
      set((s) => ({ messages: [...s.messages, { id: uid(), role: "assistant", response, retry: { message, params: extra } }] }));
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      const code = e instanceof ApiError ? (e.code ?? (e.status === 0 ? "backend" : e.status === 429 ? "rate" : "generic")) : "generic";
      set((s) => ({ messages: [...s.messages, { id: uid(), role: "assistant", errorCode: code, retry: { message, params: extra } }] }));
    } finally {
      set({ pending: false });
    }
  },

  clear: () => {
    controller?.abort();
    void resetChat(get().sessionId);
    useExplore.getState().setAiPicks([]);
    set({ messages: [], sessionId: newSessionId(), pending: false, anchor: null });
  },
}));
