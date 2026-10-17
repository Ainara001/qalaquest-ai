import { useTranslation } from "react-i18next";
import { CategoryDot } from "@/components/explore/CategoryDot";
import { formatDistance } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PoiItem } from "@/services/pois";

export function PoiListItem({ poi, active, onClick }: { poi: PoiItem; active: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "w-full rounded-md border px-3 py-2.5 text-left transition-colors hover:border-primary",
          active ? "border-primary bg-accent" : "bg-card",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="font-medium leading-snug">{poi.name ?? t("explore.unnamed")}</span>
          {poi.distance_m !== null && (
            <span className="shrink-0 text-sm font-medium text-primary">{formatDistance(poi.distance_m, t)}</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <CategoryDot category={poi.category} />
          {t(`categorySingular.${poi.category}`)}
        </div>
        {poi.address && <div className="mt-0.5 truncate text-xs text-muted-foreground">{poi.address}</div>}
      </button>
    </li>
  );
}
