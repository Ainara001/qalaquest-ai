import { OpenBadge } from "@/components/OpenBadge";
import { ArrowLeft, Bookmark, ChevronDown, CloudSun, ExternalLink, Footprints, Globe, Heart, Info, MapPin, Phone, Smile, Sparkles, ThumbsUp, User, X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { CategoryDot } from "@/components/explore/CategoryDot";
import { formatDate, formatDistance } from "@/lib/format";
import { reasonLines, type ReasonKind } from "@/lib/reasons";
import { resolveStart } from "@/lib/start";
import { cn } from "@/lib/utils";
import { usePoiDetail } from "@/hooks/usePois";
import type { PoiDetail } from "@/services/pois";
import { useWalkContext } from "@/stores/context";
import { useExplore } from "@/stores/explore";
import { useGuide } from "@/stores/guide";
import { useMapUi } from "@/stores/mapui";
import { useProfile } from "@/stores/profile";
import { useRecs } from "@/stores/recs";
import { useWalk } from "@/stores/walk";

const REASON_ICON: Record<ReasonKind, typeof Info> = {
  mood: Smile, weather: CloudSun, profile: User, request: Sparkles, favorite: Heart, feedback: ThumbsUp, distance: MapPin, default: Info,
};

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="space-y-0.5 py-2.5">
    <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
    <dd className="text-sm">{children}</dd>
  </div>
);

/** Facts that the source confirms (OSM tags); nothing is inferred from the category or the mood. */
function confirmedFacts(poi: PoiDetail, t: (k: string, o?: Record<string, unknown>) => string): string[] {
  const tags = poi.tags ?? {};
  const out: string[] = [];
  if (tags.fee === "no") out.push(t("place.facts.free"));
  if (tags.fee === "yes") out.push(t("place.facts.paid"));
  if (poi.wheelchair) out.push(t("place.facts.wheelchair", { v: t(`poi.wheelchairValues.${poi.wheelchair}`, { defaultValue: poi.wheelchair }) }));
  if (tags.cuisine) out.push(t("place.facts.cuisine", { v: tags.cuisine.replace(/;/g, ", ").replace(/_/g, " ") }));
  if (tags.internet_access && tags.internet_access !== "no") out.push(t("place.facts.internet"));
  if (tags.outdoor_seating === "yes") out.push(t("place.facts.outdoorSeating"));
  if (tags.historic) out.push(t("place.facts.historic"));
  if (tags.artwork_type) out.push(t("place.facts.artwork"));
  return out;
}

export function PlaceHeader({ id }: { id: number }) {
  const { t } = useTranslation();
  const origin = useExplore((s) => s.origin);
  const select = useExplore((s) => s.select);
  const { data: poi } = usePoiDetail(id, origin ? { lat: origin.lat, lon: origin.lon } : null);
  const ui = useMapUi();
  return (
    <div className="flex items-start gap-2">
      <button type="button" onClick={() => { select(null); ui.back(); }} aria-label={t("poi.back")} className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-muted">
        <ArrowLeft className="h-5 w-5" />
      </button>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-lg font-bold leading-tight">{poi?.id === id ? poi.name ?? t("explore.unnamed") : t("common.loading")}</h2>
        {poi?.id === id && (
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><CategoryDot category={poi.category} /> {t(`categorySingular.${poi.category}`)}</span>
            {poi.distance_m !== null && <span>· {formatDistance(poi.distance_m, t)} {t("place.straight")}</span>}
          </p>
        )}
      </div>
      <button type="button" onClick={() => { select(null); ui.open("results", "collapsed"); }} aria-label={t("explore.closeCard")} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-muted">
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}

/** Place card over the map: reason, confirmed facts, and actions (route, save, details, ask the AI guide). */
export function PlacePanel({ id }: { id: number }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const origin = useExplore((s) => s.origin);
  const { data: poi, loading, error, reload } = usePoiDetail(id, origin ? { lat: origin.lat, lon: origin.lon } : null);
  const ui = useMapUi();
  const prof = useProfile();
  const walk = useWalk();
  const time = useWalkContext((c) => c.timeMinutes);
  const rec = useRecs((s) => s.results.find((r) => r.poi_id === id));
  const setAnchor = useGuide((g) => g.setAnchor);

  if (error)
    return (
      <div className="py-4 text-sm text-muted-foreground">
        {t("explore.loadError")}{" "}
        <button type="button" onClick={reload} className="font-medium text-primary">{t("common.retry")}</button>
      </div>
    );
  if (!poi || poi.id !== id) return <p className="py-4 text-sm text-muted-foreground">{loading ? t("common.loading") : t("explore.loadError")}</p>;

  const saved = prof.feedback.saved.includes(id);
  const full = ui.sheet === "full";
  const facts = confirmedFacts(poi, t);
  const reasons = rec ? reasonLines(rec, t, false) : [];
  const otherNames = (["original", "ru", "kk", "en"] as const).filter((k) => poi.names[k] && poi.names[k] !== poi.name);

  const route = async () => {
    ui.open("route", "half");
    const start = await resolveStart();
    // a single place: generous budget unless the user set one (the backend still refuses what does not fit)
    await walk.plan({ start, time_minutes: time ?? 180, poi_ids: [id] });
  };

  return (
    <article className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <button type="button" onClick={route} disabled={walk.pending} className="flex h-14 flex-col items-center justify-center gap-0.5 rounded-2xl bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-50">
          <Footprints className="h-5 w-5" /> {t("place.route")}
        </button>
        <button
          type="button"
          aria-pressed={saved}
          onClick={() => prof.toggleFeedback(id, "saved", { name: poi.name, category: poi.category })}
          className={cn("flex h-14 flex-col items-center justify-center gap-0.5 rounded-2xl border text-xs font-semibold", saved && "border-primary bg-accent text-accent-foreground")}
        >
          <Bookmark className={cn("h-5 w-5", saved && "fill-current")} /> {saved ? t("place.saved") : t("place.save")}
        </button>
        <button type="button" aria-expanded={full} onClick={() => ui.setSheet(full ? "half" : "full")} className="flex h-14 flex-col items-center justify-center gap-0.5 rounded-2xl border text-xs font-semibold">
          <ChevronDown className={cn("h-5 w-5 transition-transform", !full && "rotate-180")} /> {full ? t("place.less") : t("place.more")}
        </button>
      </div>

      {reasons.length > 0 && (
        <div className="rounded-2xl bg-accent/60 p-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-accent-foreground">{t("place.why")}</p>
          <ul className="space-y-1">
            {reasons.map((r) => {
              const Icon = REASON_ICON[r.kind];
              return <li key={r.kind} className="flex items-start gap-1.5 text-[13px] leading-snug"><Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--brand))]" /> {r.text}</li>;
            })}
          </ul>
        </div>
      )}

      <dl className="divide-y">
        <Row label={t("poi.location")}>
          <span className="flex items-start gap-1.5">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>{poi.address ?? <span className="text-muted-foreground">{t("place.noAddress")}</span>}</span>
          </span>
        </Row>
        <Row label={t("poi.hours")}>
          <span className="flex flex-wrap items-center gap-2">
            <OpenBadge status={poi.open_status} />
            {poi.opening_hours ? <span className="font-mono text-xs">{poi.opening_hours}</span> : <span className="text-muted-foreground">{t("poi.hoursUnknown")}</span>}
          </span>
        </Row>
        {facts.length > 0 && (
          <Row label={t("place.confirmed")}>
            <ul className="flex flex-wrap gap-1.5">{facts.map((f) => <li key={f} className="rounded-full bg-muted px-2.5 py-1 text-xs">{f}</li>)}</ul>
          </Row>
        )}
      </dl>

      {full && (
        <dl className="divide-y border-t">
          {poi.phone && (
            <Row label={t("poi.phone")}>
              <a className="inline-flex items-center gap-1.5 text-primary hover:underline" href={`tel:${poi.phone.replace(/[^+\d]/g, "")}`}><Phone className="h-3.5 w-3.5" /> {poi.phone}</a>
            </Row>
          )}
          {poi.website && /^https?:\/\//i.test(poi.website) && (
            <Row label={t("poi.website")}>
              <a className="inline-flex items-center gap-1.5 break-all text-primary hover:underline" href={poi.website} target="_blank" rel="noopener noreferrer">
                <Globe className="h-3.5 w-3.5 shrink-0" /> {poi.website.replace(/^https?:\/\//i, "")}
              </a>
            </Row>
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
                  <li key={k}><span className="mr-1.5 text-xs uppercase text-muted-foreground">{k === "original" ? t("poi.nameOriginal") : k}</span>{poi.names[k]}</li>
                ))}
              </ul>
            </Row>
          )}
          <Row label={t("poi.coordinates")}>
            <span className="font-mono text-xs text-muted-foreground">{poi.latitude.toFixed(5)}, {poi.longitude.toFixed(5)}</span>
          </Row>
          <Row label={t("poi.source")}>
            <div className="space-y-1">
              {poi.source_url && (
                <a className="inline-flex items-center gap-1.5 text-primary hover:underline" href={poi.source_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" /> {t("poi.sourceLink")}</a>
              )}
              {poi.wikidata && (
                <div><a className="text-primary hover:underline" href={`https://www.wikidata.org/wiki/${poi.wikidata}`} target="_blank" rel="noopener noreferrer">{t("poi.wikidata")}: {poi.wikidata}</a></div>
              )}
              <p className="text-xs text-muted-foreground">
                {t("poi.attribution")}
                {poi.source_updated_at && <> · {t("poi.dataFrom", { date: formatDate(poi.source_updated_at, i18n.language) })}</>}
              </p>
            </div>
          </Row>
          <p className="py-2 text-xs text-muted-foreground">{t("place.noPhoto")}</p>
        </dl>
      )}

      <button
        type="button"
        onClick={() => {
          setAnchor({ id: poi.id, name: poi.name });
          navigate("/guide");
        }}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border text-sm font-semibold text-primary"
      >
        <Sparkles className="h-4 w-4" /> {t("explore.toGuide")}
      </button>
    </article>
  );
}
