import maplibregl, { type GeoJSONSource, type Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { createElement, useEffect, useRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Flag } from "lucide-react";
import { CATEGORY_COLORS, CATEGORY_ICONS } from "@/lib/categories";
import type { PoiFeatureCollection } from "@/services/pois";
import type { AiPick } from "@/stores/explore";

// OpenFreeMap: free OSM-based vector tiles, no API key. Attribution is shown by the map control.
const STYLES = { light: "https://tiles.openfreemap.org/styles/positron", dark: "https://tiles.openfreemap.org/styles/dark" };
const ASTANA: [number, number] = [71.4304, 51.1282];
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const BRAND = "#0f766e";
const BASE_LAYERS = ["poi-clusters", "poi-cluster-count", "poi-points", "poi-icons"];

export interface Highlight {
  id: number;
  lat: number;
  lon: number;
}

interface Props {
  points: PoiFeatureCollection | null;
  selected: { id: number; lat: number; lon: number } | null;
  origin: { lat: number; lon: number } | null;
  radiusKm: number;
  aiPicks: AiPick[];
  aiFocus: number;
  // recommendation layer beyond the numbered pins (separate source, can be switched off)
  highlights?: Highlight[];
  // the regular POI layer is drawn faded while recommendations are shown (never removed: search still finds everything)
  dimBase?: boolean;
  // stops of the active quest (flag markers), shown while other panels are open
  questStops?: Highlight[];
  // real walking route (Valhalla legs); empty when routing is unavailable — nothing is drawn then
  route?: number[][][];
  routeFocus?: number;
  showRadius?: boolean;
  picking: boolean;
  lang: string;
  theme: "light" | "dark";
  // part of the map hidden by the bottom sheet (px), so fly-to keeps the place in the visible area
  bottomInset?: number;
  onSelect: (id: number) => void;
  onPick: (lat: number, lon: number) => void;
  onError: () => void;
}

function circlePolygon(lat: number, lon: number, km: number): GeoJSON.Feature<GeoJSON.Polygon> {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    const dLat = (km / 111.32) * Math.sin(a);
    const dLon = (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a);
    pts.push([lon + dLon, lat + dLat]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [pts] } };
}

// White category pictograms drawn on top of the coloured marker circles (generated once per page load).
let iconCache: Promise<Record<string, HTMLImageElement>> | null = null;
function categoryIcons(): Promise<Record<string, HTMLImageElement>> {
  iconCache ??= Promise.all(
    Object.entries(CATEGORY_ICONS).map(
      ([cat, Icon]) =>
        new Promise<[string, HTMLImageElement | null]>((resolve) => {
          const svg = renderToStaticMarkup(createElement(Icon, { color: "#ffffff", size: 28, strokeWidth: 2.4 }));
          const img = new Image(28, 28);
          img.onload = () => resolve([cat, img]);
          img.onerror = () => resolve([cat, null]);
          img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        }),
    ),
  ).then((list) => Object.fromEntries(list.filter((x): x is [string, HTMLImageElement] => x[1] !== null)));
  return iconCache;
}

// Amber round flag marker for the stops of an active quest.
let flagCache: Promise<HTMLImageElement | null> | null = null;
function questFlag(): Promise<HTMLImageElement | null> {
  flagCache ??= new Promise((resolve) => {
    const glyph = renderToStaticMarkup(createElement(Flag, { color: "#ffffff", size: 14, strokeWidth: 2.6 })).replace("<svg ", '<svg x="7" y="7" ');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 28 28"><circle cx="14" cy="14" r="12" fill="#d97706" stroke="#ffffff" stroke-width="2.5"/>${glyph}</svg>`;
    const img = new Image(56, 56);
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  return flagCache;
}

export function MapView(props: Props) {
  const { points, selected, origin, radiusKm, picking, lang, theme, aiPicks, aiFocus } = props;
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const live = useRef(props);
  live.current = props; // handlers always see the latest props without re-binding map events

  // Apply data/state to the map (safe to call repeatedly, and after a style swap).
  const sync = () => {
    const map = mapRef.current;
    // isStyleLoaded() is false while tiles stream in; our own layers existing is the right check.
    if (!map || !map.getSource("pois")) return;
    const p = live.current;
    (map.getSource("pois") as GeoJSONSource | undefined)?.setData(p.points ?? EMPTY);
    // clusters have no "id": coalesce keeps the comparison numeric (avoids "expected number, found null")
    map.setFilter("poi-selected", ["==", ["coalesce", ["get", "id"], -2], p.selected?.id ?? -1]);
    (map.getSource("ai") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: p.aiPicks.map((a) => ({ type: "Feature", properties: { id: a.id, n: String(a.n) }, geometry: { type: "Point", coordinates: [a.lon, a.lat] } })),
    });
    const pinned = new Set(p.aiPicks.map((a) => a.id));
    (map.getSource("quest") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: (p.questStops ?? []).filter((h) => !pinned.has(h.id)).map((h) => ({ type: "Feature", properties: { id: h.id }, geometry: { type: "Point", coordinates: [h.lon, h.lat] } })),
    });
    const questIds = new Set((p.questStops ?? []).map((h) => h.id));
    (map.getSource("rec") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      // one marker per place: a quest flag or a numbered pin wins over the recommendation ring
      features: (p.highlights ?? []).filter((h) => !pinned.has(h.id) && !questIds.has(h.id)).map((h) => ({ type: "Feature", properties: { id: h.id }, geometry: { type: "Point", coordinates: [h.lon, h.lat] } })),
    });
    const o = p.origin;
    (map.getSource("origin") as GeoJSONSource | undefined)?.setData(
      o ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [o.lon, o.lat] } }] } : EMPTY,
    );
    (map.getSource("radius") as GeoJSONSource | undefined)?.setData(
      o && p.showRadius !== false ? { type: "FeatureCollection", features: [circlePolygon(o.lat, o.lon, p.radiusKm)] } : EMPTY,
    );
    (map.getSource("route") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: (p.route ?? []).filter((g) => g.length > 1).map((g) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: g } })),
    });
    const fade = p.dimBase ? 0.35 : 1;
    for (const id of BASE_LAYERS) {
      if (!map.getLayer(id)) continue;
      const type = map.getLayer(id)!.type;
      if (type === "circle") {
        map.setPaintProperty(id, "circle-opacity", fade);
        map.setPaintProperty(id, "circle-stroke-opacity", fade);
      } else if (type === "symbol") {
        map.setPaintProperty(id, id === "poi-icons" ? "icon-opacity" : "text-opacity", fade);
      }
    }
    // Local labels: name:kk / name:ru when the tiles carry them, otherwise the original name.
    for (const layer of map.getStyle().layers) {
      if (layer.type !== "symbol" || layer.id.startsWith("poi-")) continue;
      const tf = JSON.stringify(map.getLayoutProperty(layer.id, "text-field") ?? "");
      if (tf.includes('"name')) {
        map.setLayoutProperty(layer.id, "text-field", ["coalesce", ["get", `name:${p.lang === "kk" ? "kk" : "ru"}`], ["get", "name"]]);
      }
    }
  };

  const addLayers = (map: MlMap) => {
    map.addSource("radius", { type: "geojson", data: EMPTY });
    map.addLayer({ id: "radius-fill", type: "fill", source: "radius", paint: { "fill-color": "#0891b2", "fill-opacity": 0.06 } });
    map.addLayer({ id: "radius-line", type: "line", source: "radius", paint: { "line-color": "#0891b2", "line-width": 1.5, "line-dasharray": [2, 2] } });

    map.addSource("route", { type: "geojson", data: EMPTY });
    map.addLayer({ id: "route-casing", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#ffffff", "line-width": 9 } });
    map.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": BRAND, "line-width": 5 } });

    // clusterMaxZoom 14: from street level on, every place is its own marker (no hundreds of identical dots at city zoom)
    map.addSource("pois", { type: "geojson", data: EMPTY, cluster: true, clusterRadius: 50, clusterMaxZoom: 14 });
    map.addLayer({
      id: "poi-clusters", type: "circle", source: "pois", filter: ["has", "point_count"],
      // white "count" bubbles, so they never look like the teal numbered "rank" pins of recommendations
      paint: {
        "circle-color": "#ffffff",
        "circle-radius": ["step", ["get", "point_count"], 14, 25, 18, 100, 23],
        "circle-stroke-width": 2, "circle-stroke-color": "#94a3b8",
      },
    });
    map.addLayer({
      id: "poi-cluster-count", type: "symbol", source: "pois", filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Bold"], "text-size": 12 },
      paint: { "text-color": "#334155" },
    });
    map.addLayer({
      id: "poi-points", type: "circle", source: "pois", filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": ["match", ["get", "category"], ...Object.entries(CATEGORY_COLORS).flat(), "#64748b"] as unknown as string,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 6, 15, 11],
        "circle-stroke-width": 2, "circle-stroke-color": "#ffffff",
      },
    });
    map.addLayer({
      id: "poi-icons", type: "symbol", source: "pois", filter: ["!", ["has", "point_count"]], minzoom: 13.5,
      layout: { "icon-image": ["concat", "cat-", ["get", "category"]], "icon-size": 0.5, "icon-allow-overlap": true, "icon-ignore-placement": true },
    });
    map.addLayer({
      id: "poi-selected", type: "circle", source: "pois", filter: ["==", ["coalesce", ["get", "id"], -2], -1],
      paint: { "circle-radius": 15, "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 3, "circle-stroke-color": "#f59e0b" },
    });

    // Recommendation layer ("places for you" beyond the numbered top picks): ring markers, never clustered
    map.addSource("rec", { type: "geojson", data: EMPTY });
    map.addLayer({
      id: "poi-rec", type: "circle", source: "rec",
      paint: { "circle-radius": 10, "circle-color": "#ffffff", "circle-stroke-width": 4, "circle-stroke-color": BRAND },
    });

    // Active quest stops: flag markers (symbol layer; the image is added once it is generated)
    map.addSource("quest", { type: "geojson", data: EMPTY });
    map.addLayer({
      id: "quest-stops", type: "symbol", source: "quest",
      layout: { "icon-image": "quest-flag", "icon-size": 0.75, "icon-allow-overlap": true, "icon-ignore-placement": true },
    });

    // Top recommendations / route stops: numbered pins drawn above everything else
    map.addSource("ai", { type: "geojson", data: EMPTY });
    map.addLayer({
      id: "poi-ai", type: "circle", source: "ai",
      paint: { "circle-radius": 15, "circle-color": BRAND, "circle-stroke-width": 3, "circle-stroke-color": "#ffffff" },
    });
    map.addLayer({
      id: "poi-ai-n", type: "symbol", source: "ai",
      layout: { "text-field": ["get", "n"], "text-font": ["Noto Sans Bold"], "text-size": 14, "text-allow-overlap": true, "text-ignore-placement": true },
      paint: { "text-color": "#ffffff" },
    });

    map.addSource("origin", { type: "geojson", data: EMPTY });
    map.addLayer({
      id: "origin-dot", type: "circle", source: "origin",
      paint: { "circle-radius": 8, "circle-color": "#2563eb", "circle-stroke-width": 3, "circle-stroke-color": "#ffffff" },
    });

    void categoryIcons().then((icons) => {
      if (mapRef.current !== map) return;
      for (const [cat, img] of Object.entries(icons)) if (!map.hasImage(`cat-${cat}`)) map.addImage(`cat-${cat}`, img, { pixelRatio: 2 });
    });
    void questFlag().then((img) => {
      if (img && mapRef.current === map && !map.hasImage("quest-flag")) map.addImage("quest-flag", img, { pixelRatio: 2 });
    });
  };

  // Create the map once; it survives language and theme changes.
  useEffect(() => {
    const map = new maplibregl.Map({
      container: box.current!, style: STYLES[live.current.theme], center: ASTANA, zoom: 11,
      minZoom: 8, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("style.load", () => {
      addLayers(map);
      sync();
    });
    map.on("error", (e) => {
      // Only a failed style/tile source is fatal for the user; ignore missing glyph ranges etc.
      if ((e as { sourceId?: string }).sourceId === "openmaptiles" && !map.isStyleLoaded()) live.current.onError();
    });

    map.on("click", "poi-clusters", async (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: ["poi-clusters"] })[0];
      const src = map.getSource("pois") as GeoJSONSource;
      const zoom = await src.getClusterExpansionZoom(f.properties.cluster_id);
      map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: zoom + 0.5 });
    });
    // one click selects one place: the topmost layer wins (numbered pin > recommendation ring > regular marker)
    map.on("click", (e) => {
      if (live.current.picking) {
        if (map.queryRenderedFeatures(e.point, { layers: ["poi-points", "poi-clusters", "poi-ai", "poi-rec", "quest-stops"] }).length) return;
        live.current.onPick(e.lngLat.lat, e.lngLat.lng);
        return;
      }
      const hit = map.queryRenderedFeatures(e.point, { layers: ["poi-ai", "quest-stops", "poi-rec", "poi-points"] })[0];
      const id = hit?.properties?.id;
      if (id !== undefined) live.current.onSelect(Number(id));
    });
    for (const layer of ["poi-clusters", "poi-points", "poi-ai", "poi-rec", "quest-stops"]) {
      map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = live.current.picking ? "crosshair" : ""));
    }

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(box.current!);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(sync, [points, selected?.id, origin?.lat, origin?.lon, radiusKm, lang, aiPicks, props.highlights, props.questStops, props.dimBase, props.route, props.showRadius]);

  useEffect(() => {
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = picking ? "crosshair" : "";
  }, [picking]);

  // Theme swap: replace the base style; layers come back through "style.load".
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    // diff:false forces a full reload so "style.load" fires and our layers are re-added.
    mapRef.current?.setStyle(STYLES[theme], { diff: false });
  }, [theme]);

  // Fly to the selected place, keeping it in the part of the map that the sheet does not cover.
  useEffect(() => {
    const map = mapRef.current;
    if (!selected || !map) return;
    const phone = window.innerWidth < 768;
    const bottom = phone ? (live.current.bottomInset ?? Math.round((box.current?.clientHeight ?? 0) * 0.5)) : 0;
    map.easeTo({ center: [selected.lon, selected.lat], zoom: Math.max(map.getZoom(), 15.5), duration: 600, padding: { top: phone ? 130 : 40, bottom, left: 0, right: 0 } });
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Frame the whole walking route when it changes
  useEffect(() => {
    const map = mapRef.current;
    const coords = (live.current.route ?? []).flat();
    const pts = [...coords, ...live.current.aiPicks.map((a) => [a.lon, a.lat]), ...(live.current.origin ? [[live.current.origin.lon, live.current.origin.lat]] : [])];
    if (!map || !props.routeFocus || pts.length < 2) return;
    const b = new maplibregl.LngLatBounds();
    pts.forEach((c) => b.extend(c as [number, number]));
    const phone = window.innerWidth < 768;
    map.fitBounds(b, { padding: { top: phone ? 140 : 60, bottom: phone ? (live.current.bottomInset ?? Math.round((box.current?.clientHeight ?? 600) * 0.45)) + 20 : 60, left: 40, right: 40 }, maxZoom: 16, duration: 600 });
  }, [props.routeFocus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Frame the numbered picks when asked (new recommendations, "on the map" from the guide)
  useEffect(() => {
    const map = mapRef.current;
    const picks = live.current.aiPicks;
    if (!map || !aiFocus || picks.length === 0) return;
    const phone = window.innerWidth < 768;
    const bottom = phone ? (live.current.bottomInset ?? 220) + 20 : 60;
    if (picks.length === 1) {
      map.easeTo({ center: [picks[0].lon, picks[0].lat], zoom: Math.max(map.getZoom(), 14), duration: 600, padding: { top: phone ? 140 : 40, bottom, left: 0, right: 0 } });
      return;
    }
    const b = new maplibregl.LngLatBounds();
    picks.forEach((a) => b.extend([a.lon, a.lat]));
    map.fitBounds(b, { padding: { top: phone ? 150 : 60, bottom, left: 50, right: 50 }, maxZoom: 15.5, duration: 600 });
  }, [aiFocus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Frame the search radius when an origin is chosen.
  useEffect(() => {
    if (!origin || props.showRadius === false) return;
    const k = radiusKm;
    const dLat = k / 111.32;
    const dLon = k / (111.32 * Math.cos((origin.lat * Math.PI) / 180));
    mapRef.current?.fitBounds([[origin.lon - dLon, origin.lat - dLat], [origin.lon + dLon, origin.lat + dLat]], { padding: 60, duration: 600, maxZoom: 16 });
  }, [origin?.lat, origin?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={box} className="h-full w-full" />;
}
