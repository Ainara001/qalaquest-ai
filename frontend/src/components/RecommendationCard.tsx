import { OpenBadge } from "@/components/OpenBadge";
import { ExternalLink, Map as MapIcon, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CategoryDot } from "@/components/explore/CategoryDot";
import { FeedbackBar } from "@/components/FeedbackBar";
import { WhyPanel } from "@/components/WhyPanel";
import { Button } from "@/components/ui/button";
import { formatDistance } from "@/lib/format";
import type { Recommendation } from "@/services/ai";

/** Card for one real POI returned by the backend. Facts come from the database; reason/idea are marked AI text. */
export function RecommendationCard({ rec, index, onMap }: { rec: Recommendation; index?: number; onMap: () => void }) {
  const { t } = useTranslation();
  const dist = rec.distance_m !== null ? t("guide.card.distance", { d: formatDistance(rec.distance_m, t) }) : null;

  return (
    <article className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="space-y-3 p-4">
        <header className="flex items-start gap-3">
          {index !== undefined && (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{index}</span>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold leading-snug">{rec.name ?? t("explore.unnamed")}</h3>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <CategoryDot category={rec.category} />
                {t(`categorySingular.${rec.category}`)}
              </span>
              {dist && <span>· {dist}</span>}
            </p>
          </div>
        </header>

        {rec.reason && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("guide.card.reason")}</p>
            <p className="mt-0.5 text-sm leading-relaxed">{rec.reason}</p>
          </div>
        )}
        {rec.activity_idea && (
          <div className="rounded-xl bg-accent/70 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent-foreground" title={t("guide.card.ideaHint")}>
              <Sparkles className="h-3.5 w-3.5" /> {t("guide.card.idea")} · {t("common.aiBadge")}
            </p>
            <p className="mt-0.5 text-sm leading-relaxed">{rec.activity_idea}</p>
          </div>
        )}

        <ul className="space-y-1 text-[13px] text-muted-foreground">
          {rec.travel_estimate && <li>{t("guide.card.travel", { min: rec.travel_estimate.minutes })}</li>}
          {rec.visit_estimate && <li>{t("guide.card.visit", { min: rec.visit_estimate.minutes })}</li>}
          <li>
            <span className="font-medium text-foreground">{t("guide.card.hours")}:</span> <OpenBadge status={rec.open_status} />{" "}
            {rec.opening_hours ? <span className="font-mono text-xs">{rec.opening_hours}</span> : t("guide.card.hoursUnknown")}
          </li>
          <li>{t(`guide.card.fee.${rec.fee}`)}</li>
          {rec.address && <li>{rec.address}</li>}
          {rec.wheelchair && <li>{t("guide.card.wheelchair", { v: t(`poi.wheelchairValues.${rec.wheelchair}`, { defaultValue: rec.wheelchair }) })}</li>}
        </ul>

        <WhyPanel rec={rec} />
        <FeedbackBar poiId={rec.poi_id} name={rec.name} category={rec.category} />
      </div>

      <footer className="flex items-center justify-between gap-2 border-t bg-muted/50 px-4 py-2.5">
        <div className="min-w-0 text-xs text-muted-foreground">
          <span>{t("guide.card.source")}: </span>
          {rec.source.url ? (
            <a href={rec.source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              {t("guide.card.sourceLink")} <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            t("guide.card.sourceLink")
          )}
          <span className="block">{t(`guide.card.confidence.${rec.confidence.level}`)}</span>
        </div>
        <Button size="sm" onClick={onMap} className="shrink-0">
          <MapIcon className="h-4 w-4" /> {t("guide.card.onMap")}
        </Button>
      </footer>
    </article>
  );
}
