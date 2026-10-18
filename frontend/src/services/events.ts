import { api } from "./api";

export type EventCategory = "exhibition" | "music" | "party" | "theatre" | "other";
export const EVENT_CATEGORIES: EventCategory[] = ["exhibition", "music", "theatre", "party", "other"];
export type EventWhen = "today" | "tomorrow" | "weekend" | "evening" | "upcoming";
export const EVENT_WHEN: EventWhen[] = ["today", "evening", "tomorrow", "weekend", "upcoming"];

export interface EventItem {
  id: number;
  title: string;
  category: EventCategory;
  venue: string | null;
  poi_id: number | null;
  latitude: number | null;
  longitude: number | null;
  start_at: string | null;
  end_at: string | null;
  organizer: string | null;
  price: string | null;
  age_limit: string | null;
  source_name: string;
  source_url: string;
  verification_status: "source_listed" | "time_unconfirmed" | "place_unconfirmed";
  last_checked_at: string;
  distance_m: number | null;
}

export interface EventsResponse {
  sources_connected: number;
  sources: string[];
  last_checked_at: string | null;
  window_start: string;
  window_end: string;
  items: EventItem[];
}

export function fetchEvents(when: EventWhen, categories: EventCategory[], origin: { lat: number; lon: number } | null, signal?: AbortSignal) {
  const p = new URLSearchParams({ when });
  categories.forEach((c) => p.append("category", c));
  if (origin) {
    p.set("latitude", String(origin.lat));
    p.set("longitude", String(origin.lon));
  }
  return api<EventsResponse>(`/api/events?${p}`, { signal });
}
