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

export type QuestType = "explorer" | "photo_hunt" | "architecture" | "history" | "family" | "city_secrets";
export const QUEST_TYPES: QuestType[] = ["explorer", "photo_hunt", "architecture", "history", "family", "city_secrets"];

export interface QuestTask {
  id: string;
  poi_ids: number[];
  kind: "visit" | "photo" | "observe" | "compare" | "rest";
  template: string;
  params: Record<string, string | number>;
  facts: string[];
  text: string | null;
  hours_unknown: boolean;
}

export interface Quest {
  id: string;
  type: QuestType;
  title: string | null;
  stops: number[];
  tasks: QuestTask[];
  estimated_minutes: number | null;
  route: import("./routes").Route;
  generated_by: "template" | "ai";
  notices: Notice[];
  used_location: NonNullable<AiResponse["used_location"]>;
}

export const generateQuest = (body: Record<string, unknown>, signal?: AbortSignal) => post<Quest>("/api/ai/quests/generate", body, signal);

export interface GroupMemberInput {
  name: string;
  interests: string[];
  mood: string | null;
  budget: "free" | "2000" | "5000" | "10000" | "any" | null;
  time_minutes: number | null;
  pace: "slow" | "normal" | "active" | null;
  wheelchair: boolean;
  with_children: boolean;
}

export interface GroupResponse {
  status: "ok" | "no_results";
  places: { place: Recommendation; members: number[]; fit: number[] }[];
  route: import("./routes").Route | null;
  members: { index: number; name: string | null; satisfaction: number; level: "high" | "medium" | "low"; fits: number[] }[];
  group_score: number | null;
  common: { time_minutes: number | null; budget: string | null; pace: string; wheelchair: boolean; with_children: boolean };
  compromise: Notice[];
  sets_checked: number;
  used_location: NonNullable<AiResponse["used_location"]>;
  notices: Notice[];
}

export const recommendGroup = (body: Record<string, unknown>, signal?: AbortSignal) => post<GroupResponse>("/api/ai/groups/recommend", body, signal);
