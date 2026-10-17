import { Database } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { CategoryDot } from "@/components/explore/CategoryDot";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { fetchStats, type PoiStats } from "@/services/pois";
import { useExplore } from "@/stores/explore";

/** Real category counts from the database; an honest empty state when nothing is imported. */
export function DataOverview() {
  const { t, i18n } = useTranslation();
  const [stats, setStats] = useState<PoiStats | null>(null);
  const [failed, setFailed] = useState(false);
  const { reset, toggleCategory } = useExplore();

  useEffect(() => {
    fetchStats().then(setStats).catch(() => setFailed(true));
  }, []);

  const entries = stats ? Object.entries(stats.by_category).sort((a, b) => b[1] - a[1]) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" /> {t("home.dataTitle")}
        </CardTitle>
        <CardDescription>{t("home.dataSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        {failed ? (
          <p className="text-sm text-muted-foreground">{t("explore.loadError")}</p>
        ) : !stats ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : stats.total === 0 ? (
          <div>
            <p className="font-medium">{t("home.dataEmpty")}</p>
            <p className="text-sm text-muted-foreground">{t("home.dataEmptyHint")}</p>
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm font-medium">{t("home.dataTotal", { count: stats.total })}</p>
            <div className="flex flex-wrap gap-2">
              {entries.map(([cat, n]) => (
                <Link
                  key={cat}
                  to="/explore"
                  onClick={() => {
                    reset();
                    toggleCategory(cat);
                  }}
                  className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-sm hover:border-primary"
                >
                  <CategoryDot category={cat} /> {t(`categories.${cat}`)} <span className="text-muted-foreground">{n}</span>
                </Link>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              {stats.last_successful_update && <>{t("home.dataUpdated", { date: formatDate(stats.last_successful_update, i18n.language) })} · </>}
              {t("home.dataSource")}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
