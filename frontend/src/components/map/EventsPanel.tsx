import { CalendarDays, Drama, ExternalLink, Footprints, Image, Info, Loader2, Music, PartyPopper, RefreshCw, X, type LucideIcon } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { formatDistance } from "@/lib/format";
import { resolveStart } from "@/lib/start";
import { cn } from "@/lib/utils";
import { EVENT_CATEGORIES, EVENT_WHEN, type EventCategory, type EventItem } from "@/services/events";
import { useEvents } from "@/stores/events";
import { useExplore } from "@/stores/explore";
import { useMapUi } from "@/stores/mapui";
import { useWalk } from "@/stores/walk";

// one pictogram per kind of event (also used for the map markers)
export const EVENT_ICONS: Record<EventCategory, LucideIcon> = {
  exhibition: Image, music: Music, party: PartyPopper, theatre: Drama, other: CalendarDays,
};
export const EVENT_COLORS: Record<EventCategory, string> = {
  exhibition: "#c026d3", music: "#2563eb", party: "#e11d48", theatre: "#db2777", other: "#475569",
};

// browsers often lack Kazakh ICU data ("M10"), so Kazakh uses a language-neutral numeric date; Astana time (UTC+5)
const fmt = (iso: string, lang: string) =>
  lang === "kk"
    ? new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
    : new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export function EventsHeader() {
  const { t } = useTranslation();
  const ui = useMapUi();
  const ev = useEvents();
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-lg font-bold leading-tight">
        <CalendarDays className="h-5 w-5 text-[hsl(var(--brand))]" /> {t("events.title")}
        {ev.status === "loading" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </h2>
      <button type="button" onClick={() => ui.open("results", "collapsed")} aria-label={t("common.close")} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted">
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}

function EventRow({ e }: { e: EventItem }) {
  const { t, i18n } = useTranslation();
  const ui = useMapUi();
  const walk = useWalk();
  const Icon = EVENT_ICONS[e.category];
  return (
    <li className="rounded-2xl border bg-background p-3">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white" style={{ background: EVENT_COLORS[e.category] }}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-snug">{e.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t(`events.cat.${e.category}`)}
            {e.start_at && <> · {e.verification_status === "time_unconfirmed" ? t("events.dateOnly", { date: fmt(e.start_at, i18n.language).split(",").slice(0, 2).join(",") }) : fmt(e.start_at, i18n.language)}</>}
            {e.distance_m !== null && <> · {formatDistance(e.distance_m, t)}</>}
          </p>
          {e.venue && <p className="text-xs text-muted-foreground">{e.venue}</p>}
          {e.verification_status !== "source_listed" && <p className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">{t(`events.status.${e.verification_status}`)}</p>}
          {e.price && <p className="text-xs">{t("events.price", { v: e.price })}</p>}
          <p className="mt-1 text-[11px] text-muted-foreground">
            <a href={e.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              {e.source_name} <ExternalLink className="h-3 w-3" />
            </a>{" "}
            · {t("events.checked", { date: fmt(e.last_checked_at, i18n.language) })}
          </p>
        </div>
      </div>
      {e.poi_id && (
        <button
          type="button"
          disabled={walk.pending}
          onClick={async () => {
            ui.open("route", "half");
            await walk.plan({ start: await resolveStart(), time_minutes: 180, poi_ids: [e.poi_id!] });
          }}
          className="mt-2 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold"
        >
          <Footprints className="h-4 w-4" /> {t("place.route")}
        </button>
      )}
    </li>
  );
}

/** Events layer: only real dated events from verified sources; an honest notice when none is connected. */
export function EventsPanel() {
  const { t } = useTranslation();
  const ev = useEvents();
  const origin = useExplore((s) => s.origin);
  useEffect(() => {
    void ev.load();
  }, [origin?.lat, origin?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  const pill = (on: boolean) => cn("flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium", on ? "border-primary bg-primary text-primary-foreground" : "bg-background");
  const d = ev.data;
  return (
    <div className="space-y-3">
      <div className="scroll-hide -mx-4 flex gap-2 overflow-x-auto px-4">
        {EVENT_WHEN.map((w) => <button key={w} type="button" aria-pressed={ev.when === w} onClick={() => ev.setWhen(w)} className={pill(ev.when === w)}>{t(`events.when.${w}`)}</button>)}
      </div>
      <div className="scroll-hide -mx-4 flex gap-2 overflow-x-auto px-4">
        {EVENT_CATEGORIES.map((c) => {
          const Icon = EVENT_ICONS[c];
          return <button key={c} type="button" aria-pressed={ev.categories.includes(c)} onClick={() => ev.toggleCategory(c)} className={pill(ev.categories.includes(c))}><Icon className="h-4 w-4" /> {t(`events.cat.${c}`)}</button>;
        })}
      </div>

      {ev.status === "error" ? (
        <div className="rounded-2xl border bg-background p-4 text-sm">
          <p>{t(`guide.errors.${ev.errorCode}`, { defaultValue: t("guide.errors.generic") })}</p>
          <button type="button" onClick={() => void ev.load()} className="mt-2 inline-flex h-10 items-center gap-2 rounded-xl border px-4 font-semibold"><RefreshCw className="h-4 w-4" /> {t("common.retry")}</button>
        </div>
      ) : !d ? (
        <div className="h-24 animate-pulse rounded-2xl bg-muted" />
      ) : d.sources_connected === 0 ? (
        <div role="status" className="flex items-start gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">{t("events.noSourcesTitle")}</p>
            <p className="mt-1 text-muted-foreground">{t("events.noSourcesText")}</p>
          </div>
        </div>
      ) : d.items.length === 0 ? (
        <p className="rounded-2xl border bg-background p-4 text-sm text-muted-foreground">{t("events.empty")}</p>
      ) : (
        <ul className="space-y-2">{d.items.map((e) => <EventRow key={e.id} e={e} />)}</ul>
      )}
      {d && d.sources_connected > 0 && <p className="text-[11px] text-muted-foreground">{t("events.sourcesLine", { list: d.sources.join(", ") })}</p>}
      <p className="text-[11px] text-muted-foreground">{t("events.disclaimer")}</p>
    </div>
  );
}
