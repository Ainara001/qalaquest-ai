import { ArrowLeft, ExternalLink, Globe, MapPin, Phone, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { CategoryDot } from "@/components/explore/CategoryDot";
import { Button } from "@/components/ui/button";
import { formatDate, formatDistance } from "@/lib/format";
import { usePoiDetail } from "@/hooks/usePois";
import { useGuide } from "@/stores/guide";
import { useExplore } from "@/stores/explore";

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="space-y-0.5 py-2.5">
    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
    <dd className="text-sm">{children}</dd>
  </div>
);

export function PoiDetailView({ id }: { id: number }) {
  const { t, i18n } = useTranslation();
  const { origin, select } = useExplore();
  const navigate = useNavigate();
  const setAnchor = useGuide((g) => g.setAnchor);
  const { data: poi, loading, error, reload } = usePoiDetail(id, origin ? { lat: origin.lat, lon: origin.lon } : null);

  const back = (
    <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => select(null)}>
      <ArrowLeft className="h-4 w-4" /> {t("poi.back")}
    </Button>
  );

  if (error)
    return (
      <div>
        {back}
        <p className="text-sm text-muted-foreground">{t("explore.loadError")}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={reload}>{t("common.retry")}</Button>
      </div>
    );
  if (!poi)
    return (
      <div>
        {back}
        <p className="text-sm text-muted-foreground">{loading ? t("common.loading") : t("explore.loadError")}</p>
      </div>
    );

  const otherNames = (["original", "ru", "kk", "en"] as const).filter((k) => poi.names[k] && poi.names[k] !== poi.name);

  return (
    <article>
      {back}
      <h2 className="text-xl font-bold leading-tight">{poi.name ?? t("explore.unnamed")}</h2>
      <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
        <CategoryDot category={poi.category} />
        {t(`categorySingular.${poi.category}`)}
      </p>

      <Button
        size="sm"
        className="mt-3 w-full"
        onClick={() => {
          setAnchor({ id: poi.id, name: poi.name });
          navigate("/guide");
        }}
      >
        <Sparkles className="h-4 w-4" /> {t("explore.toGuide")}
      </Button>

      <dl className="mt-3 divide-y">
        {poi.distance_m !== null && (
          <Row label={t("poi.distance")}>
            <span className="font-semibold text-primary">{formatDistance(poi.distance_m, t)}</span>{" "}
            <span className="text-muted-foreground">({t("poi.distanceMethod")})</span>
          </Row>
        )}
        <Row label={t("poi.location")}>
          <span className="flex items-start gap-1.5">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>
              {poi.address && <span className="block">{poi.address}</span>}
              <span className="font-mono text-xs text-muted-foreground">
                {poi.latitude.toFixed(5)}, {poi.longitude.toFixed(5)}
              </span>
            </span>
          </span>
        </Row>
        <Row label={t("poi.hours")}>
          {poi.opening_hours ? <span className="font-mono text-xs">{poi.opening_hours}</span> : <span className="text-muted-foreground">{t("poi.hoursUnknown")}</span>}
        </Row>
        {poi.phone && (
          <Row label={t("poi.phone")}>
            <a className="inline-flex items-center gap-1.5 text-primary hover:underline" href={`tel:${poi.phone.replace(/[^+\d]/g, "")}`}>
              <Phone className="h-3.5 w-3.5" /> {poi.phone}
            </a>
          </Row>
        )}
        {poi.website && /^https?:\/\//i.test(poi.website) && (
          <Row label={t("poi.website")}>
            <a className="inline-flex items-center gap-1.5 break-all text-primary hover:underline" href={poi.website} target="_blank" rel="noopener noreferrer">
              <Globe className="h-3.5 w-3.5 shrink-0" /> {poi.website.replace(/^https?:\/\//i, "")}
            </a>
          </Row>
        )}
        {poi.wheelchair && (
          <Row label={t("poi.wheelchair")}>{t(`poi.wheelchairValues.${poi.wheelchair}`, { defaultValue: poi.wheelchair })}</Row>
        )}
        {poi.description && (
          <Row label={t("poi.description")}>
            <p>{poi.description}</p>
            {!poi.description_lang && <p className="mt-1 text-xs text-muted-foreground">{t("poi.descriptionOriginal")}</p>}
          </Row>
        )}
        {otherNames.length > 0 && (
          <Row label={t("poi.names")}>
            <ul className="space-y-0.5">
              {otherNames.map((k) => (
                <li key={k}>
                  <span className="mr-1.5 text-xs uppercase text-muted-foreground">{k === "original" ? t("poi.nameOriginal") : k}</span>
                  {poi.names[k]}
                </li>
              ))}
            </ul>
          </Row>
        )}
        <Row label={t("poi.source")}>
          <div className="space-y-1">
            {poi.source_url && (
              <a className="inline-flex items-center gap-1.5 text-primary hover:underline" href={poi.source_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" /> {t("poi.sourceLink")}
              </a>
            )}
            {poi.wikidata && (
              <div>
                <a className="text-primary hover:underline" href={`https://www.wikidata.org/wiki/${poi.wikidata}`} target="_blank" rel="noopener noreferrer">
                  {t("poi.wikidata")}: {poi.wikidata}
                </a>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {t("poi.attribution")}
              {poi.source_updated_at && <> · {t("poi.dataFrom", { date: formatDate(poi.source_updated_at, i18n.language) })}</>}
            </p>
          </div>
        </Row>
      </dl>
    </article>
  );
}
