import { Clock, CloudSun, Footprints, Gift, Loader2, MapPin, RefreshCw, Shuffle, Sparkles, Smile, User, WandSparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CategoryDot } from "@/components/explore/CategoryDot";
import { formatDistance } from "@/lib/format";
import { resolveStart } from "@/lib/start";
import { useWalkContext } from "@/stores/context";
import { useExplore } from "@/stores/explore";
import { useMapUi } from "@/stores/mapui";
import { useSurprise } from "@/stores/surprise";
import { useWalk } from "@/stores/walk";

const REASON_ICON: Record<string, typeof Gift> = {
  mood: Smile, interests: User, new_category: Gift, unusual_category: WandSparkles, indoor_in_adverse_weather: CloudSun,
  outdoor_in_good_weather: CloudSun, close: MapPin, not_shown_before: Shuffle,
};

export function SurpriseHeader() {
  const { t } = useTranslation();
  const ui = useMapUi();
  const s = useSurprise();
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-lg font-bold leading-tight">
        <Gift className="h-5 w-5 text-[hsl(var(--brand))]" /> {t("surprise.title")}
        {s.status === "loading" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </h2>
      <button type="button" onClick={() => ui.open("results", "collapsed")} aria-label={t("common.close")} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted">
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}

/** One unexpected but relevant real place; "another option" draws again without repeats. */
export function SurprisePanel() {
  const { t } = useTranslation();
  const s = useSurprise();
  const ui = useMapUi();
  const walk = useWalk();
  const time = useWalkContext((c) => c.timeMinutes);
  const select = useExplore((e) => e.select);
  const r = s.result;
  const p = r?.place ?? null;

  if (s.status === "error")
    return (
      <div className="space-y-3 text-sm">
        <p>{t(`guide.errors.${s.errorCode}`, { defaultValue: t("guide.errors.generic") })}</p>
        <button type="button" onClick={() => void s.next()} className="inline-flex h-10 items-center gap-2 rounded-xl border px-4 font-semibold">
          <RefreshCw className="h-4 w-4" /> {t("common.retry")}
        </button>
      </div>
    );
  if (!r || (s.status === "loading" && !p)) return <div className="h-40 animate-pulse rounded-2xl bg-muted" />;
  if (!p)
    return (
      <div className="space-y-3 text-sm">
        <p className="font-medium">{t("surprise.none")}</p>
        <p className="text-muted-foreground">{t("surprise.noneHint")}</p>
        <div className="flex flex-wrap gap-2">
          {s.history.length > 0 && <button type="button" onClick={() => { s.resetHistory(); void s.next(); }} className="h-10 rounded-xl border px-4 font-semibold">{t("surprise.startOver")}</button>}
          <button type="button" onClick={() => ui.setPicker("filters")} className="h-10 rounded-xl border px-4 font-semibold">{t("recs.changeFilters")}</button>
        </div>
      </div>
    );

  const ideaText = p.activity_idea ?? t(`surprise.idea.${p.category}`, { defaultValue: "" });
  return (
    <article className="space-y-3">
      <div className="rounded-2xl border bg-background p-4">
        <h3 className="text-xl font-bold leading-snug">{p.name ?? t("explore.unnamed")}</h3>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5"><CategoryDot category={p.category} /> {t(`categorySingular.${p.category}`)}</span>
          {p.distance_m !== null && <span>· {formatDistance(p.distance_m, t)} {t("place.straight")}</span>}
        </p>
        <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
          {r.travel_minutes !== null && <li className="flex items-center gap-1"><Footprints className="h-3.5 w-3.5" /> {t("surprise.travel", { n: r.travel_minutes })}</li>}
          {r.visit_minutes !== null && <li className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {t("surprise.visit", { n: r.visit_minutes })}</li>}
        </ul>
      </div>

      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("surprise.why")}</p>
        {p.reason && <p className="mb-1.5 text-sm leading-relaxed">{p.reason} <span className="text-xs text-muted-foreground">· {t("common.aiBadge")}</span></p>}
        <ul className="space-y-1">
          {r.reasons.map((code) => {
            const Icon = REASON_ICON[code] ?? Sparkles;
            const mood = p.explanation.mood;
            return (
              <li key={code} className="flex items-start gap-1.5 text-[13px] leading-snug">
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--brand))]" />
                {t(`surprise.reasons.${code}`, { mood: mood ? t(`mood.${mood}`) : "", category: t(`categorySingular.${p.category}`).toLowerCase() })}
              </li>
            );
          })}
        </ul>
      </div>

      {ideaText && (
        <div className="rounded-xl bg-accent/70 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent-foreground">
            <Sparkles className="h-3.5 w-3.5" /> {t("surprise.what")} · {r.idea_source === "ai" ? t("common.aiBadge") : t("surprise.byCategory")}
          </p>
          <p className="mt-0.5 text-sm leading-relaxed">{ideaText}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            useExplore.getState().focusAiPicks();
            ui.setSheet("collapsed");
          }}
          className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground"
        >
          <MapPin className="h-4 w-4" /> {t("surprise.showOnMap")}
        </button>
        <button type="button" disabled={s.status === "loading"} onClick={() => void s.next()} className="flex h-12 items-center justify-center gap-2 rounded-2xl border text-sm font-semibold disabled:opacity-50">
          {s.status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shuffle className="h-4 w-4" />} {t("surprise.another")}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={walk.pending}
          onClick={async () => {
            ui.open("route", "half");
            await walk.plan({ start: await resolveStart(), time_minutes: time ?? 180, poi_ids: [p.poi_id] });
          }}
          className="flex h-11 items-center justify-center gap-2 rounded-2xl border text-sm font-semibold"
        >
          <Footprints className="h-4 w-4" /> {t("place.route")}
        </button>
        <button type="button" onClick={() => select(p.poi_id)} className="h-11 rounded-2xl border text-sm font-semibold">{t("place.more")}</button>
      </div>
      <p className="text-[11px] text-muted-foreground">{t("surprise.disclaimer", { n: r.pool_size })}</p>
    </article>
  );
}
