import { BatteryLow, Check, Crosshair, Flag, Footprints, LocateFixed, Loader2, MapPin, RefreshCw, Send, Shuffle, Smile, Sparkles, Timer, Umbrella, Utensils, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/BottomSheet";
import { INTEREST_ICONS } from "@/components/icons";
import { ChangeSummary, Notices, StartLabel, StopList, Totals, WhyRoute } from "@/components/walk/WalkParts";
import { WeatherCard } from "@/components/WeatherCard";
import { useLocate } from "@/hooks/useLocate";
import { CITY_CENTER } from "@/lib/start";
import { cn } from "@/lib/utils";
import { getPosition } from "@/services/geo";
import type { RouteEvent, StartPoint } from "@/services/routes";
import { useWalkContext } from "@/stores/context";
import { useExplore } from "@/stores/explore";
import { useMapUi } from "@/stores/mapui";
import { PROFILE_INTERESTS, useProfile, type ProfileInterest } from "@/stores/profile";
import { remainingMinutes, useWalk } from "@/stores/walk";

const TIMES = [30, 60, 90, 120];

export function walkErrorText(code: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  return t(`walk.errors.${code}`, { defaultValue: "" }) || t(`guide.errors.${code}`, { defaultValue: "" }) || t("guide.errors.generic");
}

function ErrorBox() {
  const { t } = useTranslation();
  const w = useWalk();
  if (!w.error) return null;
  return (
    <div role="alert" className="flex items-start justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
      {walkErrorText(w.error, t)}
      <button type="button" onClick={w.clearError} aria-label={t("common.close")}><X className="h-4 w-4" /></button>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn("flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium", on ? "border-primary bg-primary text-primary-foreground" : "bg-background")}>
      {children}
    </button>
  );
}

/** Header of the walk panels: title + key numbers, visible even when the sheet is collapsed. */
export function WalkHeader({ mode }: { mode: "route" | "walk" | "plan" }) {
  const { t } = useTranslation();
  const w = useWalk();
  const ui = useMapUi();
  const s = w.session;
  const route = mode === "walk" ? s?.route : mode === "route" ? w.draft : null;
  const title = mode === "walk" ? t("walk.title") : mode === "route" ? t("walk.routeTitle") : t("walk.planTitle");
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold leading-tight">{title}</h2>
        <div className="flex items-center gap-1">
          {w.pending && <Loader2 className="h-5 w-5 animate-spin text-primary" aria-label={t("walk.loading")} />}
          {mode !== "walk" && (
            <button type="button" onClick={() => { if (mode === "route") w.discardDraft(); ui.back(); }} aria-label={t("common.close")} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted">
              <X className="h-5 w-5" />
            </button>
          )}
          {mode === "walk" && (
            <button type="button" onClick={() => ui.open("results", "collapsed")} aria-label={t("walk.toMap")} className="flex h-9 items-center rounded-full border px-3 text-xs font-medium">
              {t("walk.toMap")}
            </button>
          )}
        </div>
      </div>
      {route && <Totals route={route} remaining={mode === "walk" && s ? remainingMinutes(s) : undefined} />}
    </div>
  );
}

/** A computed route that is not started yet (quick route from a place card, or a planned walk). */
export function RoutePreviewPanel() {
  const { t } = useTranslation();
  const w = useWalk();
  const ui = useMapUi();
  const d = w.draft;
  if (w.pending && !d) return <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("walk.planning")}</p>;
  return (
    <div className="space-y-3">
      <ErrorBox />
      {d && (
        <>
          <StartLabel source={d.start.source} label={d.start.label} />
          {useProfile.getState().prefs.wheelchair && <p role="note" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] dark:border-amber-800 dark:bg-amber-950/40">{t("a11y.routeWarning")}</p>}
          <Notices route={d} />
          {d.stops.length > 0 ? <StopList route={d} /> : <p className="text-sm text-muted-foreground">{t("walk.noFeasible")}</p>}
          {d.stops.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => { w.start(); ui.open("walk", "half"); }} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground">
                <Footprints className="h-4 w-4" /> {t("walk.startWalk")}
              </button>
              <button type="button" onClick={() => { w.discardDraft(); ui.back(); }} className="h-12 rounded-2xl border text-sm font-semibold">{t("walk.discard")}</button>
            </div>
          )}
          <WhyRoute route={d} />
        </>
      )}
      {!d && !w.pending && !w.error && <p className="text-sm text-muted-foreground">{t("walk.noRoute")}</p>}
    </div>
  );
}

/** Plan a walk from scratch: start point, time, number of places. */
export function PlanWalkPanel() {
  const { t } = useTranslation();
  const w = useWalk();
  const ui = useMapUi();
  const ex = useExplore();
  const ctxTime = useWalkContext((c) => c.timeMinutes);
  const loc = useLocate();
  const [center, setCenter] = useState(false);
  const [minutes, setMinutes] = useState(ctxTime && TIMES.includes(ctxTime) ? ctxTime : 60);
  const [places, setPlaces] = useState(3);
  const start: StartPoint | null = ex.origin
    ? { latitude: ex.origin.lat, longitude: ex.origin.lon, source: ex.origin.source === "geolocation" ? "geolocation" : "manual" }
    : center ? CITY_CENTER : null;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("walk.planHint")}</p>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">{t("walk.startFrom")}</p>
        <div className="flex flex-wrap gap-2">
          <Chip on={ex.origin?.source === "geolocation"} onClick={() => void loc.locate()}><LocateFixed className="h-4 w-4" /> {t("walk.startMyLocation")}</Chip>
          <Chip on={ex.origin?.source === "manual"} onClick={() => { ex.setPicking(true); ui.setSheet("collapsed"); }}><Crosshair className="h-4 w-4" /> {ex.origin?.source === "manual" ? t("walk.startChosen") : t("walk.startPickOnMap")}</Chip>
          <Chip on={!ex.origin && center} onClick={() => { ex.setOrigin(null); setCenter(true); }}><MapPin className="h-4 w-4" /> {t("walk.startCenter")}</Chip>
        </div>
        {loc.state !== "idle" && loc.state !== "locating" && <p role="alert" className="text-xs text-muted-foreground">{t(`explore.geo${loc.state[0].toUpperCase()}${loc.state.slice(1)}`)}</p>}
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">{t("walk.time")}</p>
        <div className="flex flex-wrap gap-2">{TIMES.map((m) => <Chip key={m} on={minutes === m} onClick={() => setMinutes(m)}>{t("walk.minutes", { n: m })}</Chip>)}</div>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">{t("walk.places")}</p>
        <div className="flex gap-2">{[1, 2, 3].map((n) => <Chip key={n} on={places === n} onClick={() => setPlaces(n)}>{n}</Chip>)}</div>
      </div>
      <ErrorBox />
      <button
        type="button"
        disabled={!start || w.pending}
        onClick={async () => {
          if (!start) return;
          ui.open("route", "half");
          await w.plan({ start, time_minutes: minutes, places_count: places });
        }}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
      >
        {w.pending ? <><Loader2 className="h-5 w-5 animate-spin" /> {t("walk.planning")}</> : <><Sparkles className="h-5 w-5" /> {t("walk.planButton")}</>}
      </button>
      <p className="text-xs text-muted-foreground">{t("walk.planContext")}</p>
      {start && <WeatherCard lat={start.latitude} lon={start.longitude} minutes={minutes} compact />}
    </div>
  );
}

/** A re-planned route waiting for the user's decision; the map shows it while the current walk stays as it is. */
function ProposalCard({ onFinished }: { onFinished: () => void }) {
  const { t } = useTranslation();
  const w = useWalk();
  const p = w.proposal;
  if (!p) return null;
  const finishing = p.update.finished;
  const empty = !finishing && p.route.stops.length === 0;
  return (
    <section aria-live="polite" className="space-y-3 rounded-2xl border-2 border-primary bg-card p-3 shadow-sm">
      <p className="text-sm font-bold">{finishing ? t("walk.proposal.finishTitle") : t("walk.proposal.title")}</p>
      <ChangeSummary change={p.change} />
      {!finishing && <Totals route={p.route} />}
      <Notices route={p.route} />
      {!finishing && !empty && <StopList route={p.route} />}
      {empty && <p className="text-sm text-muted-foreground">{t("walk.proposal.empty")}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={empty}
          onClick={() => {
            w.applyProposal();
            if (finishing) onFinished();
          }}
          className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-40"
        >
          <Check className="h-4 w-4" /> {finishing ? t("walk.finish") : t("walk.proposal.apply")}
        </button>
        <button type="button" onClick={w.rejectProposal} className="h-12 rounded-2xl border text-sm font-semibold">{t("walk.proposal.keep")}</button>
      </div>
      <p className="text-[11px] text-muted-foreground">{t("walk.proposal.hint")}</p>
    </section>
  );
}

/** The mood on the map / in the AI guide changed during the walk: offer (never force) a re-plan. */
function MoodChanged() {
  const { t } = useTranslation();
  const w = useWalk();
  const mood = useWalkContext((c) => c.mood);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const s = w.session;
  if (!s || w.proposal || (s.prefs.mood ?? null) === mood || dismissed === String(mood)) return null;
  return (
    <div className="flex items-start gap-2 rounded-2xl bg-accent px-3 py-2.5 text-sm text-accent-foreground">
      <Smile className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p>{mood ? t("walk.moodChanged", { mood: t(`mood.${mood}`) }) : t("walk.moodCleared")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={w.pending} onClick={() => void w.replan({ type: "mood", ...(mood ? { mood } : {}) })} className="h-9 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50">
            {t("walk.moodSuggest")}
          </button>
          <button type="button" onClick={() => setDismissed(String(mood))} className="h-9 rounded-full border bg-card px-3 text-xs font-medium">{t("walk.notNow")}</button>
        </div>
      </div>
    </div>
  );
}

/** The active walk: stops, "I visited", "change route", finish. */
export function ActiveWalkPanel({ onFinished }: { onFinished: () => void }) {
  const { t } = useTranslation();
  const w = useWalk();
  const ui = useMapUi();
  const [changeOpen, setChangeOpen] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [, tick] = useState(0);
  // remaining time ticks once a minute (no polling of the backend or of the position)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, []);
  const s = w.session;
  if (!s) return <p className="text-sm text-muted-foreground">{t("walk.noWalk")}</p>;
  const route = s.route;

  const locate = async (): Promise<StartPoint | null> => {
    setGeoError(null);
    try {
      const p = await getPosition();
      return { latitude: p.lat, longitude: p.lon, source: "geolocation" };
    } catch (e) {
      const kind = (e as { kind?: string }).kind;
      setGeoError(t(`explore.geo${kind === "denied" ? "Denied" : kind === "unsupported" ? "Unsupported" : "Unavailable"}`));
      return null;
    }
  };
  const doReplan = async (ev: RouteEvent) => {
    const ok = await w.replan(ev);
    if (ok) {
      setChangeOpen(false);
      ui.setSheet(useWalk.getState().proposal ? "full" : "half");
    }
  };

  return (
    <div className="space-y-3">
      <ErrorBox />
      <ProposalCard onFinished={onFinished} />
      <MoodChanged />
      {s.change && !w.proposal && <ChangeSummary change={s.change} />}
      <Notices route={route} />
      {route.status === "no_feasible" ? (
        <p className="text-sm text-muted-foreground">{t("walk.noFeasible")}</p>
      ) : (
        <StopList route={route} busy={w.pending} onVisited={(id) => doReplan({ type: "visited", poi_id: id })} onSkip={(id) => doReplan({ type: "skip", poi_id: id })} />
      )}
      {w.proposal && <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("walk.proposal.current")}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={w.pending || !!w.proposal} onClick={() => setChangeOpen(true)} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">
          <Shuffle className="h-4 w-4" /> {t("walk.changeRoute")}
        </button>
        <button type="button" onClick={() => { w.finish(); onFinished(); }} className="flex h-12 items-center justify-center gap-2 rounded-2xl border text-sm font-semibold">
          <Flag className="h-4 w-4" /> {t("walk.finish")}
        </button>
      </div>
      <WhyRoute route={route} />
      <WeatherCard lat={(s.current ?? s.start).latitude} lon={(s.current ?? s.start).longitude} minutes={remainingMinutes(s) || 60} compact />
      <ChangeRoute open={changeOpen} onClose={() => setChangeOpen(false)} onEvent={doReplan} locate={locate} geoError={geoError} />
    </div>
  );
}

function ChangeRoute({ open, onClose, onEvent, locate, geoError }: { open: boolean; onClose: () => void; onEvent: (e: RouteEvent) => void; locate: () => Promise<StartPoint | null>; geoError: string | null }) {
  const { t } = useTranslation();
  const w = useWalk();
  const s = w.session;
  const [mode, setMode] = useState<"main" | "interests" | "replace" | "ai">("main");
  const [interests, setInterests] = useState<ProfileInterest[]>([]);
  const [text, setText] = useState("");
  useEffect(() => {
    if (open) setMode("main");
  }, [open]);
  if (!s) return null;
  const busy = w.pending;

  const row = (icon: React.ReactNode, label: string, action: () => void) => (
    <button type="button" disabled={busy} onClick={action} className="flex h-12 w-full items-center gap-3 rounded-2xl border bg-background px-4 text-left text-sm font-medium disabled:opacity-50">
      {icon} {label}
    </button>
  );

  return (
    <BottomSheet open={open} onClose={onClose} title={t("walk.changeTitle")}>
      {busy && <p className="mb-2 flex items-center gap-2 text-sm text-primary"><Loader2 className="h-4 w-4 animate-spin" /> {t("walk.loading")}</p>}
      {w.error && <p role="alert" className="mb-2 text-sm text-red-700">{walkErrorText(w.error, t)}</p>}
      {mode === "main" && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{t("walk.timeLeft")}</p>
          <div className="flex flex-wrap gap-2">
            {[15, 30, 45, 60].map((m) => (
              <button key={m} type="button" disabled={busy} onClick={() => onEvent({ type: "time_left", minutes: m })} className="h-10 rounded-full border bg-background px-3.5 text-sm font-medium disabled:opacity-50">
                <Timer className="mr-1 inline h-4 w-4" />{t("walk.minutes", { n: m })}
              </button>
            ))}
          </div>
          {row(<Footprints className="h-5 w-5" />, t("walk.lessWalking"), () => onEvent({ type: "less_walking" }))}
          {row(<BatteryLow className="h-5 w-5" />, t("walk.tired"), () => onEvent({ type: "tired" }))}
          {row(<Utensils className="h-5 w-5" />, t("walk.wantFood"), () => onEvent({ type: "want_food" }))}
          {row(<Umbrella className="h-5 w-5" />, t("walk.goIndoor"), () => onEvent({ type: "go_indoor" }))}
          {row(<Sparkles className="h-5 w-5" />, t("walk.changeInterests"), () => setMode("interests"))}
          {row(<Shuffle className="h-5 w-5" />, t("walk.otherPlace"), () => setMode("replace"))}
          {row(<Send className="h-5 w-5" />, t("walk.writeAi"), () => setMode("ai"))}
          {row(<LocateFixed className="h-5 w-5" />, t("walk.updateLocation"), async () => { const p = await locate(); if (p) onEvent({ type: "location", location: p }); })}
          {geoError && <p role="alert" className="text-xs text-muted-foreground">{geoError}</p>}
          {row(<RefreshCw className="h-5 w-5" />, t("walk.updateWeather"), () => onEvent({ type: "weather_refresh" }))}
        </div>
      )}
      {mode === "interests" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {PROFILE_INTERESTS.map((i) => {
              const Icon = INTEREST_ICONS[i];
              const on = interests.includes(i);
              return (
                <button key={i} type="button" aria-pressed={on} onClick={() => setInterests(on ? interests.filter((x) => x !== i) : [...interests, i])} className={cn("flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm", on ? "border-primary bg-primary text-primary-foreground" : "bg-background")}>
                  <Icon className="h-4 w-4" /> {t(`interest.${i}`)}
                </button>
              );
            })}
          </div>
          <button type="button" disabled={busy || interests.length === 0} onClick={() => onEvent({ type: "interests", interests })} className="h-11 w-full rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">{t("walk.applyInterests")}</button>
        </div>
      )}
      {mode === "replace" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t("walk.otherPlaceHint")}</p>
          {s.route.stops.map((st) => (
            <div key={st.poi_id}>{row(<Shuffle className="h-5 w-5" />, st.name ?? t(`categorySingular.${st.category}`), () => onEvent({ type: "reject", poi_id: st.poi_id }))}</div>
          ))}
        </div>
      )}
      {mode === "ai" && (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onEvent({ type: "message", message: text.trim() }); }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={500} placeholder={t("walk.aiPlaceholder")} aria-label={t("walk.writeAi")} className="w-full resize-none rounded-2xl border bg-background p-3 outline-none focus-visible:ring-2 focus-visible:ring-primary" />
          <button type="submit" disabled={busy || !text.trim()} className="h-11 w-full rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">{t("walk.send")}</button>
        </form>
      )}
    </BottomSheet>
  );
}
