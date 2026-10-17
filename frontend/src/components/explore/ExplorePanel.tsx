import { useTranslation } from "react-i18next";
import { CategoryChips, OriginControls, ResultsList, SearchBox } from "@/components/explore/parts";
import { PoiDetailView } from "@/components/explore/PoiDetailView";
import type { usePoiQuery } from "@/hooks/usePois";
import { useExplore } from "@/stores/explore";

/** Desktop side panel: search, start point, categories, list or details. */
export function ExplorePanel({ query }: { query: ReturnType<typeof usePoiQuery> }) {
  const { t } = useTranslation();
  const s = useExplore();
  const hasFilters = s.categories.length > 0 || s.search.trim() !== "" || s.origin !== null;
  return (
    <div className="flex h-full flex-col">
      <SearchBox />
      {s.selectedId !== null ? (
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
          <PoiDetailView id={s.selectedId} />
        </div>
      ) : (
        <>
          <div className="mt-3">
            <OriginControls />
          </div>
          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("explore.categories")}</span>
              {hasFilters && (
                <button type="button" onClick={s.reset} className="text-xs text-primary hover:underline">{t("explore.resetFilters")}</button>
              )}
            </div>
            <CategoryChips />
          </div>
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
            <ResultsList query={query} />
          </div>
        </>
      )}
    </div>
  );
}
