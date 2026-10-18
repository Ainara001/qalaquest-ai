import { CloudSun, Footprints, Heart, Info, MapPin, MessageCircle, RefreshCw, Route, Smile, Sparkles, ThumbsUp, User, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ChatMessageView, Thinking } from "@/components/ChatMessages";
import { CategoryDot } from "@/components/explore/CategoryDot";
import { ResultsList } from "@/components/explore/parts";
import { formatDistance } from "@/lib/format";
import { reasonLines, type ReasonKind } from "@/lib/reasons";
import { resolveStart } from "@/lib/start";
import { cn } from "@/lib/utils";
import type { Notice, Recommendation } from "@/services/ai";
import type { usePoiQuery } from "@/hooks/usePois";
import { useWalkContext } from "@/stores/context";
import { useExplore } from "@/stores/explore";
import { useGuide } from "@/stores/guide";
import { useMapUi } from "@/stores/mapui";
import { TOP_PINS, useRecs } from "@/stores/recs";
import { useWalk } from "@/stores/walk";

type T = (k: string, o?: Record<string, unknown>) => string;

const REASON_ICON: Record<ReasonKind, typeof Info> = {
  mood: Smile, weather: CloudSun, profile: User, request: Sparkles, favorite: Heart, feedback: ThumbsUp, distance: MapPin, default: Info,
};

export function recNoticeText(n: Notice, t: T): string | null {
  const p = n.params ?? {};
  switch (n.code) {
    case "no_results":
      return t("guide.notices.no_results", { radius: p.radius_m, wider: p.wider_radius_m, count: p.wider_count });
    case "no_confirmed_free":
      return t("guide.notices.no_confirmed_free", { radius: p.radius_m, count: p.count });
    case "no_accessible":
    case "time_too_short":
      return t(`guide.notices.${n.code}`, p);
    case "default_start_point":
      return t("recs.notices.default_start_point");
    case "weather_adapted":
      return t("recs.notices.weather_adapted", { conditions: String(p.conditions ?? "").split(",").map((c) => t(`weather.conditions.${c}`)).join(", ") });
    case "weather_unavailable":
    case "weather_stale":
      return t(`recs.notices.${n.code}`);
    default:
      return null;
  }
}

/** Short line under the title: what the list is based on right now. */
function ContextLine() {
  const { t } = useTranslation();
  const c = useWalkContext();
  const origin = useExplore((s) => s.origin);
  const radius = useExplore((s) => s.radiusKm);
  const weather = useRecs((s) => s.weather);
  const parts = [
    c.mood ? t("recs.ctx.mood", { mood: t(`moodShort.${c.mood}`) }) : null,
    origin ? t("recs.ctx.near", { km: radius }) : t("recs.ctx.city"),
    c.timeMinutes ? t("filters.timeValue", { n: c.timeMinutes }) : null,
    c.useWeather && weather ? t(weather.level === "comfortable" ? "recs.ctx.weatherOk" : "recs.ctx.weatherBad") : null,
  ].filter(Boolean);
  return <p className="truncate text-xs text-muted-foreground">{parts.join(" · ")}</p>;
}

export function RecRow({ rec, n, onOpen }: { rec: Recommendation; n: number; onOpen: () => void }) {
  const { t } = useTranslation();
  const reasons = reasonLines(rec, t, false);
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 rounded-2xl border bg-background p-3 text-left active:bg-muted">
        {n <= TOP_PINS ? (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{n}</span>
        ) : (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[3px] border-primary bg-card" aria-hidden />
        )}
        <span className="min-w-0 flex-1">
          <span className="block font-semibold leading-snug">{rec.name ?? t("explore.unnamed")}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><CategoryDot category={rec.category} /> {t(`categorySingular.${rec.category}`)}</span>
            {rec.distance_m !== null && <span>· {formatDistance(rec.distance_m, t)}</span>}
          </span>
          <span className="mt-1.5 block space-y-0.5">
            {reasons.slice(0, 3).map((r) => {
              const Icon = REASON_ICON[r.kind];
              return (
                <span key={r.kind} className="flex items-start gap-1.5 text-[13px] leading-snug">
                  <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--brand))]" /> {r.text}
                </span>
              );
            })}
          </span>
        </span>
      </button>
    </li>
  );
}

export function ResultsHeader() {
  const { t } = useTranslation();
  const ui = useMapUi();
  const recs = useRecs();
  const aiPending = useGuide((g) => g.pending);
  const showAi = ui.showAiAnswer;
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-lg font-bold leading-tight">
          {showAi ? <><Sparkles className="h-5 w-5 text-[hsl(var(--brand))]" /> {t("recs.aiTitle")}</> : t("recs.title")}
          {!showAi && recs.status === "ok" && <span className="text-sm font-medium text-muted-foreground">{recs.results.length}</span>}
          {(recs.status === "loading" || (showAi && aiPending)) && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" aria-label={t("common.loading")} />}
        </h2>
        {showAi ? <p className="text-xs text-muted-foreground">{t("recs.aiSub")}</p> : <ContextLine />}
        {!showAi && ui.sheet === "collapsed" && recs.results[0] && (
          <button type="button" onClick={() => useExplore.getState().select(recs.results[0].poi_id)} className="mt-1 flex max-w-full items-center gap-1.5 text-left text-sm">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">1</span>
            <span className="truncate font-medium">{recs.results[0].name ?? t("explore.unnamed")}</span>
          </button>
        )}
      </div>
      {showAi && (
        <button type="button" onClick={() => { ui.setShowAiAnswer(false); useExplore.getState().setAiPicks([]); }} aria-label={t("recs.hideAi")} className="flex h-9 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-medium">
          <X className="h-4 w-4" /> {t("recs.hideAi")}
        </button>
      )}
    </div>
  );
}

function AiAnswer() {
  const { t } = useTranslation();
  const { messages, pending } = useGuide();
  const lastUser = messages.map((m) => m.role).lastIndexOf("user");
  const answer = lastUser >= 0 ? messages.slice(lastUser + 1).find((m) => m.role === "assistant") : undefined;
  const question = lastUser >= 0 ? messages[lastUser].text : null;
  return (
    <div className="space-y-3">
      {question && <p className="rounded-2xl bg-muted px-3 py-2 text-sm">«{question}»</p>}
      {pending && !answer && <Thinking />}
      {answer && <ChatMessageView msg={answer} />}
      <Link to="/guide" className="inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold text-primary">
        <MessageCircle className="h-4 w-4" /> {t("recs.openGuide")}
      </Link>
    </div>
  );
}

const TIP_KEY = "qq-tip-mood-v1";
function tipSeen(): boolean {
  try {
    return localStorage.getItem(TIP_KEY) === "1";
  } catch {
    return true;
  }
}

/** One-time hint (per device) that the mood changes the map; disappears once a mood is chosen or it is closed. */
function MoodTip() {
  const { t } = useTranslation();
  const mood = useWalkContext((c) => c.mood);
  const ui = useMapUi();
  const [hidden, setHidden] = useState(tipSeen);
  if (hidden || mood) return null;
  const close = () => {
    try {
      localStorage.setItem(TIP_KEY, "1");
    } catch {
      /* storage unavailable: hide for this visit only */
    }
    setHidden(true);
  };
  return (
    <div className="flex items-start gap-2 rounded-2xl border border-primary/30 bg-accent/60 p-3 text-[13px]">
      <Smile className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--brand))]" />
      <p className="min-w-0 flex-1">
        {t("recs.tip")}{" "}
        <button type="button" onClick={() => { close(); ui.setPicker("mood"); }} className="font-semibold text-primary underline underline-offset-2">{t("recs.tipAction")}</button>
      </p>
      <button type="button" onClick={close} aria-label={t("common.close")} className="shrink-0 text-muted-foreground"><X className="h-4 w-4" /></button>
    </div>
  );
}

/** "Места для вас": the mood-aware recommendation layer as a list, the full POI list, or the last AI answer. */
export function ResultsPanel({ query }: { query: ReturnType<typeof usePoiQuery> }) {
  const { t } = useTranslation();
  const ui = useMapUi();
  const recs = useRecs();
  const c = useWalkContext();
  const walk = useWalk();
  const select = useExplore((s) => s.select);

  if (ui.showAiAnswer) return <AiAnswer />;

  const tabs = (
    <div role="tablist" className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 text-sm font-medium">
      {(["for_you", "all"] as const).map((m) => (
        <button key={m} type="button" role="tab" aria-selected={ui.listMode === m} onClick={() => ui.setListMode(m)} className={cn("h-9 rounded-lg", ui.listMode === m ? "bg-card shadow-sm" : "text-muted-foreground")}>
          {t(`recs.tab.${m}`)}
        </button>
      ))}
    </div>
  );

  if (ui.listMode === "all") return <>{tabs}<ResultsList query={query} /></>;

  const notices = recs.notices.map((n) => recNoticeText(n, t)).filter((x): x is string => !!x);
  const planTop = async () => {
    const ids = recs.results.slice(0, TOP_PINS).map((r) => r.poi_id);
    ui.open("route", "half");
    const start = await resolveStart();
    await walk.plan({ start, time_minutes: c.timeMinutes ?? 120, poi_ids: ids });
  };

  return (
    <div className="space-y-3">
      {tabs}
      <MoodTip />
      {notices.length > 0 && (
        <ul className="space-y-1.5">
          {[...new Set(notices)].map((x) => <li key={x} className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2 text-[13px] text-muted-foreground"><Info className="mt-0.5 h-4 w-4 shrink-0" /> {x}</li>)}
        </ul>
      )}
      {recs.status === "error" ? (
        <div className="rounded-2xl border bg-background p-4 text-sm">
          <p>{t(`guide.errors.${recs.errorCode}`, { defaultValue: t("guide.errors.generic") })}</p>
          <button type="button" onClick={() => recs.load(true)} className="mt-2 inline-flex h-10 items-center gap-2 rounded-xl border px-4 font-semibold">
            <RefreshCw className="h-4 w-4" /> {t("common.retry")}
          </button>
        </div>
      ) : recs.status !== "ok" && recs.results.length === 0 ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted" />)}</div>
      ) : recs.results.length === 0 ? (
        <div className="rounded-2xl border bg-background p-4 text-sm">
          <p className="font-medium">{t("recs.empty")}</p>
          <p className="mt-1 text-muted-foreground">{t("recs.emptyHint")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {c.mood && <button type="button" onClick={() => c.setMood(null)} className="h-9 rounded-full border px-3 text-xs font-medium">{t("filters.moodReset")}</button>}
            <button type="button" onClick={() => ui.setPicker("filters")} className="h-9 rounded-full border px-3 text-xs font-medium">{t("recs.changeFilters")}</button>
          </div>
        </div>
      ) : (
        <>
          <ul className={cn("space-y-2", recs.status === "loading" && "opacity-60")}>
            {recs.results.map((r, i) => <RecRow key={r.poi_id} rec={r} n={i + 1} onOpen={() => select(r.poi_id)} />)}
          </ul>
          <button type="button" disabled={walk.pending} onClick={planTop} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">
            <Footprints className="h-4 w-4" /> {t("recs.planTop", { n: Math.min(TOP_PINS, recs.results.length) })}
          </button>
          <button type="button" onClick={() => ui.open("plan", "half")} className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border text-sm font-semibold">
            <Route className="h-4 w-4" /> {t("walk.planTitle")}
          </button>
          <p className="text-[11px] text-muted-foreground">{t("recs.disclaimer")}</p>
        </>
      )}
    </div>
  );
}
