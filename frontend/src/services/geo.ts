export type GeoErrorKind = "denied" | "unavailable" | "unsupported";

export class GeoError extends Error {
  constructor(public kind: GeoErrorKind) {
    super(kind);
  }
}

/** Ask the browser for the position (the browser shows its own permission prompt). Never persisted. */
export function getPosition(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new GeoError("unsupported"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => reject(new GeoError(e.code === e.PERMISSION_DENIED ? "denied" : "unavailable")),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  });
}
