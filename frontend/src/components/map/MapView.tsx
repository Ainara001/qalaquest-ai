import maplibregl, { type GeoJSONSource, type Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { CATEGORY_COLORS } from "@/lib/categories";
import type { PoiFeatureCollection } from "@/services/pois";

// OpenFreeMap: free OSM-based vector tiles, no API key. Attribution is shown by the map control.
const STYLES = { light: "https://tiles.openfreemap.org/styles/positron", dark: "https://tiles.openfreemap.org/styles/dark" };
const ASTANA: [number, number] = [71.4304, 51.1282];
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

interface Props {
  points: PoiFeatureCollection | null;
  selected: { id: number; lat: number; lon: number } | null;
  origin: { lat: number; lon: number } | null;
  radiusKm: number;
  picking: boolean;
  lang: string;
  theme: "light" | "dark";
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

export function MapView(props: Props) {
  const { points, selected, origin, radiusKm, picking, lang, theme } = props;
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
    map.setFilter("poi-selected", ["==", ["get", "id"], p.selected?.id ?? -1]);
    const o = p.origin;
    (map.getSource("origin") as GeoJSONSource | undefined)?.setData(
      o ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [o.lon, o.lat] } }] } : EMPTY,
    );
    (map.getSource("radius") as GeoJSONSource | undefined)?.setData(
      o ? { type: "FeatureCollection", features: [circlePolygon(o.lat, o.lon, p.radiusKm)] } : EMPTY,
    );
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
    map.addLayer({ id: "radius-fill", type: "fill", source: "radius", paint: { "fill-color": "#0891b2", "fill-opacity": 0.08 } });
    map.addLayer({ id: "radius-line", type: "line", source: "radius", paint: { "line-color": "#0891b2", "line-width": 2, "line-dasharray": [2, 2] } });

    map.addSource("pois", { type: "geojson", data: EMPTY, cluster: true, clusterRadius: 48, clusterMaxZoom: 15 });
    map.addLayer({
      id: "poi-clusters", type: "circle", source: "pois", filter: ["has", "point_count"],
      paint: {
        "circle-color": ["step", ["get", "point_count"], "#0891b2", 25, "#4f46e5", 100, "#7c3aed"],
        "circle-radius": ["step", ["get", "point_count"], 16, 25, 21, 100, 27],
        "circle-stroke-width": 3, "circle-stroke-color": "#ffffff",
      },
    });
    map.addLayer({
      id: "poi-cluster-count", type: "symbol", source: "pois", filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Bold"], "text-size": 13 },
      paint: { "text-color": "#ffffff" },
    });
    map.addLayer({
      id: "poi-points", type: "circle", source: "pois", filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": ["match", ["get", "category"], ...Object.entries(CATEGORY_COLORS).flat(), "#64748b"] as unknown as string,
        "circle-radius": 7, "circle-stroke-width": 2, "circle-stroke-color": "#ffffff",
      },
    });
    map.addLayer({
      id: "poi-selected", type: "circle", source: "pois", filter: ["==", ["get", "id"], -1],
      paint: { "circle-radius": 12, "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 3, "circle-stroke-color": "#f59e0b" },
    });

    map.addSource("origin", { type: "geojson", data: EMPTY });
    map.addLayer({
      id: "origin-dot", type: "circle", source: "origin",
      paint: { "circle-radius": 8, "circle-color": "#2563eb", "circle-stroke-width": 3, "circle-stroke-color": "#ffffff" },
    });
  };

  // Create the map once; it survives language and theme changes.
  useEffect(() => {
    const map = new maplibregl.Map({
      container: box.current!, style: STYLES[live.current.theme], center: ASTANA, zoom: 11,
      minZoom: 8, attributionControl: { compact: true },
    });
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
    map.on("click", "poi-points", (e) => {
      const id = e.features?.[0]?.properties?.id;
      if (id !== undefined) live.current.onSelect(Number(id));
    });
    map.on("click", (e) => {
      if (!live.current.picking) return;
      if (map.queryRenderedFeatures(e.point, { layers: ["poi-points", "poi-clusters"] }).length) return;
      live.current.onPick(e.lngLat.lat, e.lngLat.lng);
    });
    for (const layer of ["poi-clusters", "poi-points"]) {
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

  useEffect(sync, [points, selected?.id, origin?.lat, origin?.lon, radiusKm, lang]);

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

  // Fly to the selected place.
  useEffect(() => {
    if (selected) mapRef.current?.easeTo({ center: [selected.lon, selected.lat], zoom: Math.max(mapRef.current.getZoom(), 16), duration: 600 });
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Frame the search radius when an origin is chosen.
  useEffect(() => {
    if (!origin) return;
    const k = radiusKm;
    const dLat = k / 111.32;
    const dLon = k / (111.32 * Math.cos((origin.lat * Math.PI) / 180));
    mapRef.current?.fitBounds([[origin.lon - dLon, origin.lat - dLat], [origin.lon + dLon, origin.lat + dLat]], { padding: 60, duration: 600, maxZoom: 16 });
  }, [origin?.lat, origin?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={box} className="h-full w-full" />;
}
