import { api } from "./api";

export type Interest =
  | "beautiful" | "photo" | "unusual" | "culture" | "history" | "nature" | "quiet" | "active"
  | "kids" | "food" | "coffee" | "shopping" | "architecture" | "art" | "relax" | "romantic";
export const INTERESTS: Interest[] = [
  "beautiful", "photo", "unusual", "culture", "history", "nature", "quiet", "active",
  "kids", "food", "coffee", "shopping", "architecture", "art", "relax", "romantic",
];

export interface AiParams {
  location?: { latitude: number; longitude: number };
  time_minutes?: number;
  radius_m?: number;
  categories?: string[];
  exclude_categories?: string[];
  free_only?: boolean;
  with_children?: boolean;
  interests?: Interest[];
  anchor_poi_id?: number;
  personalization?: ReturnType<typeof import("@/stores/profile").personalizationPayload>;
  // session-only options, moved into personalization.session by the guide store
  allow_unconfirmed_free?: boolean;
  company?: "solo" | "friends" | "partner" | "family";
}

export interface InterestMatch { interest: string; source: "request" | "session" | "mood" | "profile" }
export interface Explanation {
  personalized: boolean;
  matched_interests: InterestMatch[];
  matched_tags: string[];
  favorite_category: boolean;
  feedback: string[];
  constraints: Notice[];
  facts_used: string[];
  scores: Record<"semantic" | "interest" | "location" | "time" | "budget" | "context" | "feedback" | "data" | "final", number>;
}
export interface PersonalizationInfo {
  used: boolean;
  ignored_by_request: boolean;
  interests: InterestMatch[];
  mood: string | null;
  budget: string;
  places_count: number;
  constraints: Notice[];
}

export interface Estimate { minutes: number; basis: string }

export interface Recommendation {
  poi_id: number;
  name: string | null;
  name_original: string | null;
  category: string;
  subcategory: string | null;
  latitude: number;
  longitude: number;
  address: string | null;
  reason: string | null;
  activity_idea: string | null;
  distance_m: number | null;
  distance_method: string | null;
  travel_estimate: Estimate | null;
  visit_estimate: Estimate | null;
  opening_hours: string | null;
  hours_status: "known" | "unknown";
  website: string | null;
  phone: string | null;
  wheelchair: string | null;
  fee: "free" | "paid" | "unknown";
  source: { name: string; url: string | null; attribution: string };
  confidence: { level: "high" | "medium" | "low"; verified_fields: string[]; missing_fields: string[] };
  explanation: Explanation;
}

export interface Notice { code: string; params: Record<string, string | number> }

export interface AiResponse {
  status: "ok" | "needs_clarification" | "no_results";
  message: string | null;
  answer_language: "ru" | "kk" | "en";
  recommendations: Recommendation[];
  limitations: string | null;
  follow_up_question: string | null;
  notices: Notice[];
  used_location: { latitude: number; longitude: number; source: "request" | "anchor_poi" | "default_city_center"; label: string | null } | null;
  explanation_unavailable: boolean;
  personalization: PersonalizationInfo | null;
}

export interface SearchResult {
  results: Recommendation[];
  notices: Notice[];
  personalization: PersonalizationInfo | null;
}

export const searchPlaces = (body: Record<string, unknown>, signal?: AbortSignal) =>
  api<SearchResult>("/api/ai/search", { method: "POST", body: JSON.stringify(body), signal });

export const sendChat = (body: AiParams & { message: string; lang: string; session_id: string }, signal?: AbortSignal) =>
  api<AiResponse>("/api/ai/chat", { method: "POST", body: JSON.stringify(body), signal });

export const resetChat = (sessionId: string) =>
  fetch(`${(import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(/\/$/, "")}/api/ai/chat/${sessionId}`, { method: "DELETE" }).catch(() => undefined);

export interface AiStatus { llm_configured: boolean; llm_model: string | null; embedding_ready: boolean; indexed_pois: number }
export const getAiStatus = () => api<AiStatus>("/api/ai/status");
