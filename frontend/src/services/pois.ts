import { api } from "./api";

export interface PoiItem {
  id: number;
  osm_type: string;
  osm_id: number;
  name: string | null;
  name_original: string | null;
  category: string;
  subcategory: string | null;
  latitude: number;
  longitude: number;
  address: string | null;
  distance_m: number | null;
  distance_method: string | null;
}

export interface PoiList {
  items: PoiItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface PoiDetail extends PoiItem {
  names: Record<string, string | null>;
  description: string | null;
  description_lang: string | null;
  opening_hours: string | null;
  website: string | null;
  phone: string | null;
  wheelchair: string | null;
  indoor_outdoor: string | null;
  wikidata: string | null;
  source: string;
  source_url: string | null;
  source_updated_at: string | null;
  attribution: string;
}

export interface CategoryCount {
  category: string;
  label: string;
  count: number;
}

export interface PoiStats {
  total: number;
  by_category: Record<string, number>;
  last_successful_update: string | null;
  osm_data_timestamp: string | null;
  sources: { source: string; count: number; attribution: string; license_url: string }[];
}

export interface PoiFeatureCollection {
  type: "FeatureCollection";
  features: GeoJSON.Feature<GeoJSON.Point, { id: number; name: string | null; category: string }>[];
}

export interface PoiQuery {
  categories: string[];
  search: string;
  origin: { lat: number; lon: number } | null;
  radiusKm: number;
}

function qs(q: PoiQuery, lang: string, extra: Record<string, string | number> = {}): string {
  const p = new URLSearchParams({ lang });
  if (q.categories.length) p.set("category", q.categories.join(","));
  if (q.search.trim()) p.set("search", q.search.trim());
  if (q.origin) {
    p.set("latitude", String(q.origin.lat));
    p.set("longitude", String(q.origin.lon));
    p.set("radius", String(Math.round(q.radiusKm * 1000)));
  }
  for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
  return p.toString();
}

export const fetchPois = (q: PoiQuery, lang: string, offset: number, limit: number, signal?: AbortSignal) =>
  api<PoiList>(`/api/pois?${qs(q, lang, { offset, limit })}`, { signal });

export const fetchMapPoints = (q: PoiQuery, lang: string, signal?: AbortSignal) =>
  api<PoiFeatureCollection>(`/api/pois/map?${qs(q, lang)}`, { signal });

export const fetchPoi = (id: number, lang: string, origin: PoiQuery["origin"], signal?: AbortSignal) => {
  const p = new URLSearchParams({ lang });
  if (origin) {
    p.set("latitude", String(origin.lat));
    p.set("longitude", String(origin.lon));
  }
  return api<PoiDetail>(`/api/pois/${id}?${p}`, { signal });
};

export const fetchCategories = (lang: string) => api<CategoryCount[]>(`/api/pois/categories?lang=${lang}`);
export const fetchStats = () => api<PoiStats>("/api/pois/stats");
