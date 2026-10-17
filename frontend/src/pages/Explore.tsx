import { ChevronUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExplorePanel } from "@/components/explore/ExplorePanel";
import { MapView } from "@/components/map/MapView";
import { useMapPoints, usePoiDetail, usePoiQuery } from "@/hooks/usePois";
import { cn } from "@/lib/utils";
import { useExplore } from "@/stores/explore";
import { useTheme } from "@/stores/theme";

type Sheet = "peek" | "half" | "full";
const SHEET_HEIGHT: Record<Sheet, string> = { peek: "h-[7.5rem]", half: "h-[52%]", full: "h-[88%]" };

export function Explore() {
  const { t, i18n } = useTranslation();
  const { theme } = useTheme();
  const s = useExplore();
  const query = usePoiQuery();
  const points = useMapPoints(query);
  const detail = usePoiDetail(s.selectedId, null);
  const [sheet, setSheet] = useState<Sheet>("half");

  // A selected place pops the mobile sheet open.
  useEffect(() => {
    if (s.selectedId !== null) setSheet((v) => (v === "peek" ? "half" : v));
  }, [s.selectedId]);

  // Picking a point on the map: collapse the sheet so the map is reachable.
  useEffect(() => {
    if (s.picking) setSheet("peek");
  }, [s.picking]);

  const selected = useMemo(
    () => (detail.data && detail.data.id === s.selectedId ? { id: detail.data.id, lat: detail.data.latitude, lon: detail.data.longitude } : null),
    [detail.data, s.selectedId],
  );

  return (
    <div className="-mx-4 -my-8 md:mx-0 md:my-0">
      <h1 className="sr-only">{t("explore.title")}</h1>
      <div className="relative h-[calc(100dvh-3.5rem-3.75rem)] overflow-hidden md:grid md:h-[calc(100dvh-3.5rem-5rem)] md:grid-cols-[400px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] md:gap-4 md:overflow-visible">
        {/* map */}
        <div className="absolute inset-0 overflow-hidden md:static md:order-2 md:rounded-lg md:border">
          <MapView
            points={points.data}
            selected={selected}
            origin={s.origin}
            radiusKm={s.radiusKm}
            picking={s.picking}
            lang={i18n.language}
            theme={theme}
            onSelect={s.select}
            onPick={(lat, lon) => s.setOrigin({ lat, lon, source: "manual" })}
            onError={() => undefined}
          />
          {points.error && (
            <div role="alert" className="absolute left-1/2 top-3 -translate-x-1/2 rounded-md border bg-card px-3 py-1.5 text-xs shadow">
              {t("explore.mapLoadError")}
            </div>
          )}
          {points.data && points.data.features.length >= 10000 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-md border bg-card px-3 py-1.5 text-xs shadow">{t("explore.mapPointsCapped")}</div>
          )}
        </div>

        {/* panel: left column on desktop, bottom sheet on mobile */}
        <aside
          className={cn(
            "absolute inset-x-0 bottom-0 z-10 flex flex-col rounded-t-2xl border-t bg-background p-4 shadow-[0_-8px_24px_rgba(0,0,0,0.15)] transition-[height] duration-200",
            "md:static md:order-1 md:h-full md:rounded-lg md:border md:shadow-none",
            SHEET_HEIGHT[sheet],
            "md:!h-full",
          )}
        >
          <button
            type="button"
            aria-label={t("explore.title")}
            onClick={() => setSheet((v) => (v === "full" ? "peek" : v === "peek" ? "half" : "full"))}
            className="-mt-2 mb-2 flex w-full justify-center md:hidden"
          >
            <span className="flex h-5 items-center">
              <ChevronUp className={cn("h-5 w-5 text-muted-foreground transition-transform", sheet === "full" && "rotate-180")} />
            </span>
          </button>
          <div className="min-h-0 flex-1">
            <ExplorePanel query={query} />
          </div>
        </aside>
      </div>
    </div>
  );
}
