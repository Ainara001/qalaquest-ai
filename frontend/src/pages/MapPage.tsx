import { List, LocateFixed, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ExplorePanel } from "@/components/explore/ExplorePanel";
import { CategoryChips, OriginControls, ResultsList, SearchBox } from "@/components/explore/parts";
import { PoiDetailView } from "@/components/explore/PoiDetailView";
import { MapView } from "@/components/map/MapView";
import { useLocate } from "@/hooks/useLocate";
import { useMapPoints, usePoiDetail, usePoiQuery } from "@/hooks/usePois";
import { cn } from "@/lib/utils";
import { useExplore } from "@/stores/explore";
import { useTheme } from "@/stores/theme";

export function MapPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const s = useExplore();
  const query = usePoiQuery();
  const points = useMapPoints(query);
  const detail = usePoiDetail(s.selectedId, null);
  const [listOpen, setListOpen] = useState(false);
  const locate = useLocate();

  // picking a point on the map: get the list out of the way
  useEffect(() => {
    if (s.picking) setListOpen(false);
  }, [s.picking]);
  useEffect(() => {
    if (s.selectedId !== null) setListOpen(false);
  }, [s.selectedId]);

  const selected = useMemo(
    () => (detail.data && detail.data.id === s.selectedId ? { id: detail.data.id, lat: detail.data.latitude, lon: detail.data.longitude } : null),
    [detail.data, s.selectedId],
  );
  const sheet: "detail" | "list" | null = s.selectedId !== null ? "detail" : listOpen ? "list" : null;
  const hasAi = s.aiPicks.length > 0;

  return (
    <div className="page-h relative overflow-hidden md:grid md:grid-cols-[400px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] md:gap-4 md:overflow-visible">
      <h1 className="sr-only">{t("nav.map")}</h1>

      {/* map */}
      <div className="absolute inset-0 md:static md:order-2 md:overflow-hidden md:rounded-xl md:border">
        <MapView
          points={points.data}
          selected={selected}
          origin={s.origin}
          radiusKm={s.radiusKm}
          aiPicks={s.aiPicks}
          aiFocus={s.aiFocus}
          picking={s.picking}
          lang={i18n.language}
          theme={theme}
          onSelect={s.select}
          onPick={(lat, lon) => s.setOrigin({ lat, lon, source: "manual" })}
          onError={() => undefined}
        />
        {points.error && (
          <div role="alert" className="absolute left-1/2 top-24 -translate-x-1/2 rounded-md border bg-card px-3 py-1.5 text-xs shadow md:top-3">
            {t("explore.mapLoadError")}
          </div>
        )}
        {s.picking && (
          <div className="absolute left-1/2 top-24 z-10 -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-lg md:top-3">
            {t("explore.pickHint")}
          </div>
        )}
      </div>

      {/* desktop: side panel */}
      <aside className="hidden h-full rounded-xl border bg-card p-4 md:order-1 md:block">
        <ExplorePanel query={query} />
      </aside>

      {/* phone: search + categories float over the map */}
      <div className="absolute inset-x-0 top-0 z-10 space-y-2 p-3 md:hidden">
        <SearchBox />
        <CategoryChips horizontal />
      </div>

      {/* phone: floating actions */}
      <div
        className="absolute right-3 z-10 flex flex-col gap-2 md:hidden"
        style={{ bottom: sheet === "detail" ? "calc(48% + 0.75rem)" : sheet === "list" ? "calc(72% + 0.75rem)" : "0.75rem" }}
      >
        {hasAi && (
          <button
            type="button"
            onClick={() => {
              s.setAiPicks([]);
            }}
            aria-label={t("explore.clearAi")}
            className="flex h-11 items-center gap-1.5 rounded-full border bg-card px-3 text-xs font-medium shadow-md"
          >
            <X className="h-4 w-4" /> {t("explore.aiResults")}
          </button>
        )}
        <button
          type="button"
          onClick={() => setListOpen((v) => !v)}
          aria-label={t("explore.listTab")}
          className="flex h-11 w-11 items-center justify-center self-end rounded-full border bg-card shadow-md active:scale-95"
        >
          <List className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={locate.locate}
          disabled={locate.state === "locating"}
          aria-label={t("explore.myLocation")}
          className={cn(
            "flex h-11 w-11 items-center justify-center self-end rounded-full border shadow-md active:scale-95",
            s.origin?.source === "geolocation" ? "bg-primary text-primary-foreground" : "bg-card",
          )}
        >
          <LocateFixed className={cn("h-5 w-5", locate.state === "locating" && "animate-pulse")} />
        </button>
      </div>
      {locate.state !== "idle" && locate.state !== "locating" && (
        <div role="alert" className="absolute inset-x-3 top-[7.5rem] z-20 rounded-xl border bg-card p-3 text-xs shadow-lg md:hidden">
          <button type="button" onClick={locate.clear} className="float-right ml-2 text-muted-foreground" aria-label={t("common.close")}>
            <X className="h-4 w-4" />
          </button>
          {t(`explore.geo${locate.state[0].toUpperCase()}${locate.state.slice(1)}`)}
        </div>
      )}

      {/* phone: bottom sheet (selected place) or list */}
      {sheet && (
        <section
          className={cn(
            "absolute inset-x-0 bottom-0 z-20 overflow-y-auto rounded-t-2xl border-t bg-card p-4 shadow-[0_-8px_24px_rgba(15,23,42,0.12)] md:hidden",
            sheet === "detail" ? "max-h-[48%]" : "h-[72%]",
          )}
        >
          {sheet === "detail" ? (
            <PoiDetailView id={s.selectedId!} />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">{t("explore.title")}</h2>
                <button type="button" onClick={() => setListOpen(false)} aria-label={t("explore.closeCard")} className="rounded-full p-1.5 hover:bg-muted">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <OriginControls />
              <ResultsList query={query} />
            </div>
          )}
        </section>
      )}
      {sheet === "detail" && hasAi && (
        <button
          type="button"
          onClick={() => navigate("/guide")}
          className="absolute left-3 z-10 flex items-center gap-1.5 rounded-full bg-card px-3 py-2 text-xs font-medium shadow-md md:hidden"
          style={{ bottom: "calc(48% + 0.75rem)" }}
        >
          <Sparkles className="h-4 w-4 text-primary" /> {t("nav.guide")}
        </button>
      )}
    </div>
  );
}
