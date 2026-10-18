import { ArrowRight, Check, ChevronDown, Clock, Footprints, HelpCircle, MapPin, SkipForward } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CategoryDot } from "@/components/explore/CategoryDot";
import { constraintText } from "@/components/WhyPanel";
import { formatDistance } from "@/lib/format";
import type { Notice } from "@/services/ai";
import type { Route, RouteChange } from "@/services/routes";

type T = (k: string, o?: Record<string, unknown>) => string;

export function noticeText(n: Notice, t: T): string {
  if (n.code === "start_assumed") return t(`walk.notices.start_assumed_${n.params.source}`);
  const p: Record<string, unknown> = { ...n.params };
  if (typeof p.max_walk_m === "number") p.max_walk_m = p.max_walk_m;
  return t(`walk.notices.${n.code}`, { ...p, defaultValue: "" });
}

export function Totals({ route, remaining }: { route: Route; remaining?: number }) {
  const { t } = useTranslation();
  const tot = route.totals;
  if (!tot) return null;
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      <div className="rounded-xl bg-muted px-2 py-2">
        <p className="text-[11px] text-muted-foreground">{remaining !== undefined ? t("walk.remaining") : t("walk.total")}</p>
        <p className="font-bold">{remaining !== undefined ? `${remaining} ${t("common.min")}` : `≈${tot.total_minutes} ${t("common.min")}`}</p>
      </div>
      <div className="rounded-xl bg-muted px-2 py-2">
        <p className="text-[11px] text-muted-foreground">{t("walk.walkTime")}</p>
        <p className="font-bold">{tot.walk_minutes} {t("common.min")}</p>
      </div>
      <div className="rounded-xl bg-muted px-2 py-2">
        <p className="text-[11px] text-muted-foreground">{t("walk.distance")}</p>
        <p className="font-bold">{formatDistance(tot.walk_distance_m, t)}</p>
      </div>
    </div>
  );
}

export function StopList({ route, onVisited, onSkip, busy }: { route: Route; onVisited?: (id: number) => void; onSkip?: (id: number) => void; busy?: boolean }) {
  const { t } = useTranslation();
  return (
    <ol className="space-y-2">
      {route.stops.map((s, i) => {
        const leg = route.legs[i];
        return (
          <li key={s.poi_id} className="rounded-2xl border bg-background p-3">
            <div className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-snug">{s.name ?? t(`categorySingular.${s.category}`)}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><CategoryDot category={s.category} /> {t(`categorySingular.${s.category}`)}</span>
                  {s.setting !== "unknown" && <span>· {t(s.setting === "usually_indoor" ? "walk.settingIndoor" : "walk.settingOutdoor")}</span>}
                </p>
                {leg && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[13px]">
                    <Footprints className="h-3.5 w-3.5 text-[hsl(var(--brand))]" />
                    {leg.distance_method === "pedestrian_route"
                      ? t("walk.legLine", { min: Math.round(leg.walk_minutes), dist: formatDistance(leg.distance_m, t) })
                      : t("walk.legStraight", { dist: formatDistance(leg.distance_m, t) })}
                  </p>
                )}
                <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" /> {t("walk.visitEst", { n: s.visit_minutes })} · {t("walk.arrive", { n: s.arrive_after_min })}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("guide.card.hours")}: {s.opening_hours ? <span className="font-mono">{s.opening_hours}</span> : t("guide.card.hoursUnknown")}
                </p>
              </div>
            </div>
            {(onVisited || onSkip) && (
              <div className="mt-2.5 flex gap-2">
                {onVisited && (
                  <button type="button" disabled={busy} onClick={() => onVisited(s.poi_id)} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent text-sm font-medium text-accent-foreground disabled:opacity-50">
                    <Check className="h-4 w-4" /> {t("walk.visited")}
                  </button>
                )}
                {onSkip && (
                  <button type="button" disabled={busy} onClick={() => onSkip(s.poi_id)} className="flex h-10 items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-medium disabled:opacity-50">
                    <SkipForward className="h-4 w-4" /> {t("walk.skip")}
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function Notices({ route }: { route: Route }) {
  const { t } = useTranslation();
  // "routing_unavailable" is said once, by the straight-line banner below
  const items = [...route.notices, ...route.explanation.weather_effect]
    .filter((n) => !(route.status === "straight_line_only" && n.code === "routing_unavailable"))
    .map((n) => noticeText(n, t))
    .filter(Boolean);
  if (route.status === "straight_line_only") items.unshift(t("walk.straightLine"));
  if (!items.length) return null;
  return (
    <ul className="space-y-1.5">
      {[...new Set(items)].map((x) => (
        <li key={x} className="rounded-xl bg-muted px-3 py-2 text-[13px] text-muted-foreground">{x}</li>
      ))}
    </ul>
  );
}

export function WhyRoute({ route }: { route: Route }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const e = route.explanation;
  const tot = route.totals;
  const names = Object.fromEntries(route.stops.map((s) => [s.poi_id, s.name ?? t(`categorySingular.${s.category}`)]));
  const constraints = e.constraints.map((c) => constraintText(c, t)).filter(Boolean);
  return (
    <div className="rounded-2xl border bg-background">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 px-3 py-3 text-left text-sm font-medium">
        <span className="flex items-center gap-2"><HelpCircle className="h-4 w-4 text-[hsl(var(--brand))]" /> {t("walk.whyRoute")}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t px-3 py-3 text-[13px]">
          {route.message && <p className="rounded-xl bg-accent/60 p-2.5">{route.message}</p>}
          <Item title={t("walk.whyOrder")}>
            {t(`walk.order.${e.order}`, { n: e.alternatives_considered })}
            {route.routing_engine && <span className="mt-1 block text-muted-foreground">{t("walk.whyEngine", { speed: route.walking_speed_kmh })}</span>}
          </Item>
          {tot && (
            <Item title={t("walk.total")}>
              {t("walk.whyFits", { walk: tot.walk_minutes, visit: tot.visit_minutes, buffer: tot.buffer_minutes, total: tot.total_minutes })}
              {tot.time_budget_min && <> {t("walk.whyBudget", { budget: tot.time_budget_min })} — {t(tot.fits_budget ? "walk.fitsBudget" : "walk.overBudget", { budget: tot.time_budget_min })}</>}
            </Item>
          )}
          <Item title={t("walk.whyStops")}>
            <ul className="space-y-1">
              {e.selection.map((s) => (
                <li key={s.poi_id}><b>{names[s.poi_id]}</b>: {s.reasons.map((r) => t(`walk.stopReasons.${r}`)).join(", ")}</li>
              ))}
            </ul>
          </Item>
          {e.preferences.length > 0 && (
            <Item title={t("walk.whyPrefs")}>
              {e.preferences.map((m) => `${t(`interest.${m.interest}`, { defaultValue: m.interest })} (${t(`guide.whySource.${m.source}`)})`).join(", ")}
            </Item>
          )}
          <Item title={t("walk.whyWeather")}>
            {e.weather ? (
              <>
                {e.weather.conditions.map((c) => t(`weather.conditions.${c}`)).join(", ")}
                {e.weather_effect.map((n) => <span key={n.code} className="block text-muted-foreground">{noticeText(n, t)}</span>)}
              </>
            ) : (
              <span className="text-muted-foreground">{t("walk.notices.weather_unavailable")}</span>
            )}
          </Item>
          {constraints.length > 0 && <Item title={t("walk.whyConstraints")}>{constraints.join("; ")}</Item>}
          {e.missing_data.length > 0 && <Item title={t("walk.whyMissing")}>{e.missing_data.map((n) => noticeText(n, t)).join(" ")}</Item>}
        </div>
      )}
    </div>
  );
}

function Item({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div>{children}</div>
    </div>
  );
}

export function ChangeSummary({ change }: { change: RouteChange }) {
  const { t } = useTranslation();
  const reasons = change.reasons.map((r) => t(`walk.reasonCodes.${r.code}`, { ...r.params, defaultValue: "" })).filter(Boolean);
  return (
    <div className="space-y-2 rounded-2xl border border-primary/30 bg-accent/50 p-3 text-[13px]">
      <p className="font-semibold">{t("walk.changeSummary")}{reasons.length > 0 && <span className="font-normal text-muted-foreground"> · {reasons.join(", ")}</span>}</p>
      {change.removed.length > 0 && (
        <p><span className="font-medium">{t("walk.removed")}:</span> {change.removed.map((r) => `${r.name ?? "#" + r.poi_id} (${t(`walk.removedReason.${r.reason}`)})`).join(", ")}</p>
      )}
      {change.added.length > 0 && (
        <p><span className="font-medium">{t("walk.added")}:</span> {change.added.map((r) => `${r.name ?? "#" + r.poi_id} (${t(`walk.addedReason.${r.reason}`)})`).join(", ")}</p>
      )}
      {change.kept.length > 0 && <p><span className="font-medium">{t("walk.kept")}:</span> {change.kept.map((r) => r.name ?? "#" + r.poi_id).join(", ")}</p>}
      {change.before_total_minutes !== null && change.after_total_minutes !== null && (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <ArrowRight className="h-3.5 w-3.5" /> {t("walk.timeChange", { before: change.before_total_minutes, after: change.after_total_minutes })}
          {change.before_distance_m !== null && change.after_distance_m !== null && <> · {t("walk.distChange", { before: formatDistance(change.before_distance_m, t), after: formatDistance(change.after_distance_m, t) })}</>}
        </p>
      )}
    </div>
  );
}

export function StartLabel({ source, label }: { source: string; label?: string | null }) {
  const { t } = useTranslation();
  const text = source === "geolocation" ? t("walk.startMyLocation") : source === "default_city_center" ? t("walk.startCenter") : label ?? t("walk.startChosen");
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5" /> {text}</span>
  );
}
