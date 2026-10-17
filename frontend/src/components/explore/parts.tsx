import { Crosshair, LocateFixed, MapPinned, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CategoryDot } from "@/components/explore/CategoryDot";
import { PoiListItem } from "@/components/explore/PoiListItem";
import { Button } from "@/components/ui/button";
import { useCategories, usePoiList, type usePoiQuery } from "@/hooks/usePois";
import { useLocate } from "@/hooks/useLocate";
import { cn } from "@/lib/utils";
import { useExplore } from "@/stores/explore";

export function SearchBox({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { search, setSearch } = useExplore();
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("explore.searchPlaceholder")}
        aria-label={t("explore.searchLabel")}
        className="h-11 w-full rounded-xl border bg-card pl-9 pr-9 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-search-cancel-button]:hidden"
      />
      {search && (
        <button type="button" onClick={() => setSearch("")} aria-label={t("explore.clearSearch")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function CategoryChips({ horizontal = false }: { horizontal?: boolean }) {
  const { t } = useTranslation();
  const s = useExplore();
  const cats = useCategories();
  if (!cats.data?.length) return null;
  return (
    <div className={cn("flex gap-1.5", horizontal ? "scroll-hide -mx-3 overflow-x-auto px-3 pb-1" : "max-h-[6.5rem] flex-wrap overflow-y-auto")}>
      {cats.data.map((c) => {
        const on = s.categories.includes(c.category);
        return (
          <button
            key={c.category}
            type="button"
            aria-pressed={on}
            onClick={() => s.toggleCategory(c.category)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm transition-colors",
              on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary",
            )}
          >
            {!on && <CategoryDot category={c.category} />}
            {t(`categories.${c.category}`)} <span className="opacity-60">{c.count}</span>
          </button>
        );
      })}
    </div>
  );
}

export function OriginControls() {
  const { t } = useTranslation();
  const s = useExplore();
  const { state, locate } = useLocate();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={s.origin?.source === "geolocation" ? "default" : "outline"} onClick={locate} disabled={state === "locating"}>
          <LocateFixed className="h-4 w-4" /> {state === "locating" ? t("explore.locating") : t("explore.nearMe")}
        </Button>
        <Button size="sm" variant={s.picking ? "default" : "outline"} onClick={() => s.setPicking(!s.picking)}>
          <Crosshair className="h-4 w-4" /> {t("explore.pickOnMap")}
        </Button>
      </div>
      {state !== "idle" && state !== "locating" && (
        <p role="alert" className="text-xs text-muted-foreground">
          {t(`explore.geo${state[0].toUpperCase()}${state.slice(1)}`)}
        </p>
      )}
      {s.picking && <p className="text-xs text-primary">{t("explore.pickHint")}</p>}
      {s.origin && (
        <div className="rounded-xl border bg-accent/50 p-2.5 text-sm">
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
  );
}

export function ResultsList({ query }: { query: ReturnType<typeof usePoiQuery> }) {
  const { t } = useTranslation();
  const s = useExplore();
  const cats = useCategories();
  const list = usePoiList(query);
  const dbEmpty = !cats.loading && !cats.error && (cats.data?.length ?? 0) === 0;

  if (dbEmpty) return <EmptyState title={t("explore.noData")} hint={t("explore.noDataHint")} />;
  if (list.error)
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        {t("explore.loadError")}
        <div>
          <Button variant="outline" size="sm" className="mt-3" onClick={list.reload}>{t("common.retry")}</Button>
        </div>
      </div>
    );
  if (list.items.length === 0 && !list.loading) return <EmptyState title={t("explore.nothingFound")} hint={t("explore.nothingFoundHint")} />;
  return (
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
  );
}

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
      <Search className="mb-2 h-8 w-8 text-muted-foreground" />
      <p className="font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}
