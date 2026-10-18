import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CategoryDot } from "@/components/explore/CategoryDot";
import { PoiListItem } from "@/components/explore/PoiListItem";
import { Button } from "@/components/ui/button";
import { useCategories, usePoiList, type usePoiQuery } from "@/hooks/usePois";
import { cn } from "@/lib/utils";
import { useExplore } from "@/stores/explore";

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
