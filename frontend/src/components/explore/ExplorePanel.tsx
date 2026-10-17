import { Crosshair, LocateFixed, MapPinned, Search, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CategoryDot } from "@/components/explore/CategoryDot";
import { PoiDetailView } from "@/components/explore/PoiDetailView";
import { PoiListItem } from "@/components/explore/PoiListItem";
import { Button } from "@/components/ui/button";
import { useCategories, usePoiList, type usePoiQuery } from "@/hooks/usePois";
import { cn } from "@/lib/utils";
import { useExplore } from "@/stores/explore";

type GeoMessage = "locating" | "denied" | "unavailable" | "unsupported" | null;

export function ExplorePanel({ query }: { query: ReturnType<typeof usePoiQuery> }) {
  const { t } = useTranslation();
  const s = useExplore();
  const cats = useCategories();
  const list = usePoiList(query);
  const [geo, setGeo] = useState<GeoMessage>(null);

  const locate = () => {
    if (!("geolocation" in navigator)) return setGeo("unsupported");
    setGeo("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo(null);
        s.setOrigin({ lat: pos.coords.latitude, lon: pos.coords.longitude, source: "geolocation" });
      },
      (err) => setGeo(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  };

  const hasFilters = s.categories.length > 0 || s.search.trim() !== "" || s.origin !== null;
  const dbEmpty = !cats.loading && !cats.error && (cats.data?.length ?? 0) === 0;

  return (
    <div className="flex h-full flex-col">
      {/* search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={s.search}
          onChange={(e) => s.setSearch(e.target.value)}
          placeholder={t("explore.searchPlaceholder")}
          aria-label={t("explore.searchLabel")}
          className="h-10 w-full rounded-md border bg-background pl-9 pr-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-search-cancel-button]:hidden"
        />
        {s.search && (
          <button type="button" onClick={() => s.setSearch("")} aria-label={t("explore.clearSearch")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {s.selectedId !== null ? (
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
          <PoiDetailView id={s.selectedId} />
        </div>
      ) : (
        <>
          {/* origin */}
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={s.origin?.source === "geolocation" ? "default" : "outline"} onClick={locate} disabled={geo === "locating"}>
                <LocateFixed className="h-4 w-4" /> {geo === "locating" ? t("explore.locating") : t("explore.nearMe")}
              </Button>
              <Button size="sm" variant={s.picking ? "default" : "outline"} onClick={() => s.setPicking(!s.picking)}>
                <Crosshair className="h-4 w-4" /> {t("explore.pickOnMap")}
              </Button>
            </div>
            {geo && geo !== "locating" && <p role="alert" className="text-xs text-muted-foreground">{t(`explore.geo${geo[0].toUpperCase()}${geo.slice(1)}`)}</p>}
            {s.picking && <p className="text-xs text-primary">{t("explore.pickHint")}</p>}
            {s.origin && (
              <div className="rounded-md border bg-accent/50 p-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-medium">
                    <MapPinned className="h-4 w-4 text-primary" />
                    {s.origin.source === "geolocation" ? t("explore.originGeo") : t("explore.originManual")}
                  </span>
                  <button type="button" onClick={() => s.setOrigin(null)} className="text-xs text-muted-foreground hover:text-foreground">
                    {t("explore.clearOrigin")}
                  </button>
                </div>
                <label className="mt-2 block text-xs text-muted-foreground">
                  {t("explore.radius")}: <b className="text-foreground">{t("explore.radiusValue", { km: s.radiusKm })}</b>
                  <input type="range" min={0.5} max={10} step={0.5} value={s.radiusKm} onChange={(e) => s.setRadiusKm(Number(e.target.value))} className="mt-1 w-full accent-[hsl(var(--primary))]" />
                </label>
              </div>
            )}
          </div>

          {/* categories */}
          {(cats.data?.length ?? 0) > 0 && (
            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("explore.categories")}</span>
                {hasFilters && (
                  <button type="button" onClick={s.reset} className="text-xs text-primary hover:underline">{t("explore.resetFilters")}</button>
                )}
              </div>
              <div className="flex max-h-[6.5rem] flex-wrap gap-1.5 overflow-y-auto">
                {cats.data!.map((c) => {
                  const on = s.categories.includes(c.category);
                  return (
                    <button
                      key={c.category}
                      type="button"
                      aria-pressed={on}
                      onClick={() => s.toggleCategory(c.category)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                        on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary",
                      )}
                    >
                      {!on && <CategoryDot category={c.category} />}
                      {t(`categories.${c.category}`)} <span className="opacity-60">{c.count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* results */}
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
            {dbEmpty ? (
              <EmptyState title={t("explore.noData")} hint={t("explore.noDataHint")} />
            ) : list.error ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {t("explore.loadError")}
                <div><Button variant="outline" size="sm" className="mt-3" onClick={list.reload}>{t("common.retry")}</Button></div>
              </div>
            ) : list.items.length === 0 && !list.loading ? (
              <EmptyState title={t("explore.nothingFound")} hint={t("explore.nothingFoundHint")} />
            ) : (
              <>
                <p className="mb-2 text-xs text-muted-foreground">
                  {t("explore.showing", { shown: list.items.length, count: list.total })}
                  {s.origin && <> · {t("poi.distanceMethod")}</>}
                </p>
                <ul className="space-y-2">
                  {list.items.map((p) => (
                    <PoiListItem key={p.id} poi={p} active={p.id === s.selectedId} onClick={() => s.select(p.id)} />
                  ))}
                </ul>
                {list.loading && <p className="py-3 text-center text-sm text-muted-foreground">{t("common.loading")}</p>}
                {!list.loading && list.items.length < list.total && (
                  <Button variant="outline" size="sm" className="my-3 w-full" onClick={list.loadMore}>{t("explore.loadMore")}</Button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
      <Search className="mb-2 h-8 w-8 text-muted-foreground" />
      <p className="font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}
