import { getPosition } from "@/services/geo";
import type { StartPoint } from "@/services/routes";
import { useExplore } from "@/stores/explore";

export const CITY_CENTER: StartPoint = { latitude: 51.1282, longitude: 71.4304, source: "default_city_center" };

/** Start point for a route: the chosen point, else the device position (asked on this tap), else the city centre. */
export async function resolveStart(): Promise<StartPoint> {
  const ex = useExplore.getState();
  const o = ex.origin;
  if (o) return { latitude: o.lat, longitude: o.lon, source: o.source === "geolocation" ? "geolocation" : "manual" };
  try {
    const p = await getPosition();
    ex.setOrigin({ lat: p.lat, lon: p.lon, source: "geolocation" });
    return { latitude: p.lat, longitude: p.lon, source: "geolocation" };
  } catch {
    return CITY_CENTER; // reported to the user as "start: city centre"
  }
}
