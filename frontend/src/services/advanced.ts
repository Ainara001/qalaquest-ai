import { api } from "./api";
import type { Notice, Recommendation, AiResponse } from "./ai";
import type { WeatherAssessment } from "./routes";

/** Stage 6 modes built on the shared RecommendationContext (see backend/app/schemas/context.py). */
export interface SurpriseResponse {
  status: "ok" | "no_results";
  place: Recommendation | null;
  reasons: string[];
  novelty: number | null;
  relevance: number | null;
  idea_source: "ai" | "category" | "none";
  travel_minutes: number | null;
  visit_minutes: number | null;
  pool_size: number;
  used_location: NonNullable<AiResponse["used_location"]>;
  notices: Notice[];
  weather?: WeatherAssessment | null;
}

const post = <T>(path: string, body: unknown, signal?: AbortSignal) => api<T>(path, { method: "POST", body: JSON.stringify(body), signal });

export const getSurprise = (body: Record<string, unknown>, signal?: AbortSignal) => post<SurpriseResponse>("/api/ai/surprise", body, signal);
