import { useCallback } from "react";
import { getPosition, type GeoError } from "@/services/geo";
import { useExplore, type LocateState } from "@/stores/explore";

export type { LocateState };

/**
 * Ask for the device position on a user action; the result lives only in memory (explore store).
 * The state is shared, so a chip that asked for the position and the sheet that explains a refusal agree.
 */
export function useLocate() {
  const setOrigin = useExplore((s) => s.setOrigin);
  const state = useExplore((s) => s.geo);
  const setGeo = useExplore((s) => s.setGeo);
  const locate = useCallback(async () => {
    setGeo("locating");
    try {
      const p = await getPosition();
      setOrigin({ lat: p.lat, lon: p.lon, source: "geolocation" });
      setGeo("idle");
      return true;
    } catch (e) {
      setGeo((e as GeoError).kind ?? "unavailable");
      return false;
    }
  }, [setOrigin, setGeo]);
  return { state, locate, clear: () => setGeo("idle") };
}
