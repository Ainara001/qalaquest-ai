import { useCallback, useState } from "react";
import { getPosition, type GeoError } from "@/services/geo";
import { useExplore } from "@/stores/explore";

export type LocateState = "idle" | "locating" | "denied" | "unavailable" | "unsupported";

/** Ask for the device position on a user action; the result lives only in memory (explore store). */
export function useLocate() {
  const setOrigin = useExplore((s) => s.setOrigin);
  const [state, setState] = useState<LocateState>("idle");
  const locate = useCallback(async () => {
    setState("locating");
    try {
      const p = await getPosition();
      setOrigin({ lat: p.lat, lon: p.lon, source: "geolocation" });
      setState("idle");
      return true;
    } catch (e) {
      setState((e as GeoError).kind ?? "unavailable");
      return false;
    }
  }, [setOrigin]);
  return { state, locate, clear: () => setState("idle") };
}
