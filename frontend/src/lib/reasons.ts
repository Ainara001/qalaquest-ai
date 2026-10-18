import type { Recommendation } from "@/services/ai";
import { formatDistance } from "@/lib/format";

type T = (k: string, o?: Record<string, unknown>) => string;

export type ReasonKind = "mood" | "weather" | "profile" | "request" | "favorite" | "feedback" | "distance" | "default";
export interface ReasonLine {
  kind: ReasonKind;
  text: string;
}

/**
 * Why a place is on the map, split by source (stage 6 §12: mood vs weather vs persistent interests).
 * Built only from the ranking explanation returned by the backend — never from LLM text.
 */
export function reasonLines(rec: Recommendation, t: T, withDistance = true): ReasonLine[] {
  const e = rec.explanation;
  const label = (i: string) => t(`interest.${i}`, { defaultValue: i }).toLowerCase();
  const by = (src: string) => e.matched_interests.filter((m) => m.source === src).map((m) => label(m.interest));
  const out: ReasonLine[] = [];
  const mood = by("mood");
  // the mood ranks kinds of places; the card never says the place itself is calm, romantic or uncrowded
  if (mood.length && e.mood) out.push({ kind: "mood", text: t("recs.because.mood", { mood: t(`mood.${e.mood}`) }) });
  if (e.weather_fit) out.push({ kind: "weather", text: t(`recs.because.${e.weather_fit}`) });
  const request = [...by("request"), ...by("session")];
  if (request.length) out.push({ kind: "request", text: t("recs.because.request", { list: [...new Set(request)].join(", ") }) });
  const profile = by("profile");
  if (profile.length) out.push({ kind: "profile", text: t("recs.because.profile", { list: profile.join(", ") }) });
  if (e.favorite_category) out.push({ kind: "favorite", text: t("guide.favoriteCategory") });
  if (e.feedback.includes("similar_to_liked") || e.feedback.includes("category_liked")) out.push({ kind: "feedback", text: t("recs.because.liked") });
  if (!out.length) out.push({ kind: "default", text: t("recs.because.default") });
  if (withDistance && rec.distance_m !== null) out.push({ kind: "distance", text: t("recs.because.distance", { d: formatDistance(rec.distance_m, t) }) });
  return out;
}
