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
}

export const sendChat = (body: AiParams & { message: string; lang: string; session_id: string }, signal?: AbortSignal) =>
  api<AiResponse>("/api/ai/chat", { method: "POST", body: JSON.stringify(body), signal });

export const resetChat = (sessionId: string) =>
  fetch(`${(import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(/\/$/, "")}/api/ai/chat/${sessionId}`, { method: "DELETE" }).catch(() => undefined);

export interface AiStatus { llm_configured: boolean; llm_model: string | null; embedding_ready: boolean; indexed_pois: number }
export const getAiStatus = () => api<AiStatus>("/api/ai/status");
