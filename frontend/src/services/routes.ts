import { api } from "./api";
import type { InterestMatch, Notice } from "./ai";

export type PointSource = "geolocation" | "manual" | "anchor_poi" | "last_visited" | "route_start" | "default_city_center";
export interface StartPoint { latitude: number; longitude: number; source: PointSource; label?: string | null }

export interface WeatherAssessment {
  level: "comfortable" | "caution" | "indoor_preferred";
  conditions: string[];
  outdoor_cap_min: number | null;
  basis: string;
  window_minutes: number;
  max_wind_ms: number | null;
  max_gusts_ms: number | null;
  min_apparent_c: number | null;
  max_precipitation_probability_pct: number | null;
}
export interface WeatherReport {
  source: string;
  timezone: string;
  utc_offset_seconds: number;
  fetched_at: string;
  stale: boolean;
  current: { time_local: string; temperature_c: number | null; apparent_c: number | null; wind_ms: number | null; gusts_ms: number | null; precipitation_mm: number | null; summary: string };
  forecast: { time_local: string; temperature_c: number | null; precipitation_probability_pct: number | null; wind_ms: number | null; summary: string }[];
  assessment: WeatherAssessment;
  attribution: string;
}

export interface RouteStop {
  poi_id: number;
  name: string | null;
  name_original: string | null;
  category: string;
  latitude: number;
  longitude: number;
  visit_minutes: number;
  arrive_after_min: number;
  setting: "usually_indoor" | "usually_outdoor" | "unknown";
  opening_hours: string | null;
  hours_status: "known" | "unknown";
  matched_interests: InterestMatch[];
  source_url: string | null;
}
export interface RouteLeg { to_poi_id: number; distance_m: number; walk_minutes: number; distance_method: "pedestrian_route" | "geodesic_straight_line"; geometry: number[][] }
export interface RouteTotals { walk_distance_m: number; walk_minutes: number; visit_minutes: number; buffer_minutes: number; total_minutes: number; outdoor_minutes: number; time_budget_min: number | null; fits_budget: boolean }
export interface Route {
  status: "ok" | "straight_line_only" | "no_feasible";
  routing_engine: string | null;
  pace: "slow" | "normal" | "active";
  walking_speed_kmh: number;
  start: StartPoint;
  stops: RouteStop[];
  legs: RouteLeg[];
  totals: RouteTotals | null;
  explanation: {
    order: string;
    preferences: InterestMatch[];
    constraints: Notice[];
    weather: WeatherAssessment | null;
    weather_effect: Notice[];
    selection: { poi_id: number; reasons: string[] }[];
    missing_data: Notice[];
    alternatives_considered: number;
  };
  notices: Notice[];
  message: string | null;
  computed_at: string;
}
export interface ChangedStop { poi_id: number; name: string | null; reason: string }
export interface RouteChange {
  kept: ChangedStop[];
  removed: ChangedStop[];
  added: ChangedStop[];
  before_total_minutes: number | null;
  after_total_minutes: number | null;
  before_distance_m: number | null;
  after_distance_m: number | null;
  reasons: Notice[];
}
export interface SessionPrefs { less_walking: boolean; indoor: boolean; mood: string | null; interests: string[]; exclude_categories: string[] }
export interface SessionUpdate {
  version: number;
  current: StartPoint | null;
  stops: number[];
  visited: number[];
  skipped: number[];
  rejected: number[];
  remaining_min: number | null;
  prefs: SessionPrefs;
  finished: boolean;
}
export type EventType =
  | "time_left" | "less_walking" | "tired" | "want_food" | "go_indoor" | "visited" | "skip" | "reject" | "add_poi"
  | "location" | "interests" | "mood" | "weather_refresh" | "manual" | "message";
export interface RouteEvent { type: EventType; minutes?: number; poi_id?: number; location?: StartPoint; interests?: string[]; mood?: string; message?: string }

const post = <T>(path: string, body: unknown, signal?: AbortSignal) => api<T>(path, { method: "POST", body: JSON.stringify(body), signal });

export const planRoute = (body: Record<string, unknown>, signal?: AbortSignal) => post<{ route: Route }>("/api/routes/plan", body, signal);
export const replanRoute = (body: Record<string, unknown>, signal?: AbortSignal) =>
  post<{ route: Route; change: RouteChange; session: SessionUpdate }>("/api/routes/replan", body, signal);
export const getWeather = (lat?: number, lon?: number, minutes = 90) =>
  api<WeatherReport>(`/api/weather/forecast?minutes=${minutes}${lat !== undefined ? `&latitude=${lat}&longitude=${lon}` : ""}`);

export interface TransitStop { stop_id: string; name: string | null; latitude: number; longitude: number; walk_m: number; walk_minutes: number; walk_method: "pedestrian_route" | "geodesic_straight_line" }
export interface TransitOption {
  mode: "bus" | "trolleybus" | "tram" | "share_taxi";
  ref: string | null;
  name: string | null;
  direction_from: string | null;
  direction_to: string | null;
  operator: string | null;
  board: TransitStop;
  alight: TransitStop;
  stops_count: number;
  ride_distance_m: number;
  ride_minutes: number;
  total_minutes: number;
  saves_minutes: number;
  osm_url: string;
}
export interface TransitResponse {
  options: TransitOption[];
  walk_only_minutes: number;
  walk_only_distance_m: number;
  walk_method: "pedestrian_route" | "geodesic_straight_line";
  routes_in_data: number;
  data_generated_at: string | null;
}
export const getTransit = (from: { lat: number; lon: number }, to: { lat: number; lon: number }, signal?: AbortSignal) =>
  post<TransitResponse>("/api/routes/transit", { start: { latitude: from.lat, longitude: from.lon }, destination: { latitude: to.lat, longitude: to.lon } }, signal);
