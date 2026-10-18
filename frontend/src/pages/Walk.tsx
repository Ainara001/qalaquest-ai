import { Crosshair, Flag, LocateFixed, Loader2, MapPin, RefreshCw, Send, Shuffle, Sparkles, Timer, Umbrella, Footprints, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/BottomSheet";
import { INTEREST_ICONS } from "@/components/icons";
import { MapView } from "@/components/map/MapView";
import { RouteSheet, type SheetState } from "@/components/walk/RouteSheet";
import { ChangeSummary, Notices, StartLabel, StopList, Totals, WhyRoute } from "@/components/walk/WalkParts";
import { WeatherCard } from "@/components/WeatherCard";
import { cn } from "@/lib/utils";
import { getPosition } from "@/services/geo";
import type { Route, RouteEvent, StartPoint } from "@/services/routes";
import { useExplore } from "@/stores/explore";
import { PROFILE_INTERESTS, type ProfileInterest } from "@/stores/profile";
import { useTheme } from "@/stores/theme";
import { remainingMinutes, useWalk } from "@/stores/walk";

const CENTER: StartPoint = { latitude: 51.1282, longitude: 71.4304, source: "default_city_center" };
const TIMES = [30, 60, 90, 120];

function errorText(code: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  return t(`walk.errors.${code}`, { defaultValue: "" }) || t(`guide.errors.${code}`, { defaultValue: "" }) || t("guide.errors.generic");
}

export function Walk() {
  const { t, i18n } = useTranslation();
  const { theme } = useTheme();
  const w = useWalk();
  const origin = useExplore((s) => s.origin);
  const [sheet, setSheet] = useState<SheetState>("half");
  const [picking, setPicking] = useState(false);
  const [start, setStart] = useState<StartPoint | null>(() => (origin ? { latitude: origin.lat, longitude: origin.lon, source: origin.source === "geolocation" ? "geolocation" : "manual" } : null));
  const [minutes, setMinutes] = useState(60);
  const [places, setPlaces] = useState(3);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [changeOpen, setChangeOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const [, tick] = useState(0);
  const [finishedNote, setFinishedNote] = useState(false);

  // remaining time ticks once a minute (no polling of the backend or of the position)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const s = w.session;
  const route: Route | null = s ? s.route : w.draft;
  useEffect(() => setFocus((n) => n + 1), [route?.computed_at]);

  const picks = useMemo(() => (route?.stops ?? []).map((st, i) => ({ id: st.poi_id, lat: st.latitude, lon: st.longitude, name: st.name, n: i + 1 })), [route]);
  const geometry = useMemo(() => (route?.legs ?? []).map((l) => l.geometry), [route]);
  const startPt = s ? s.current ?? s.start : start;

  const locate = async (): Promise<StartPoint | null> => {
    setGeoError(null);
    try {
      const p = await getPosition();
      return { latitude: p.lat, longitude: p.lon, source: "geolocation" };
    } catch (e) {
      setGeoError(t(`explore.geo${(e as { kind?: string }).kind === "denied" ? "Denied" : (e as { kind?: string }).kind === "unsupported" ? "Unsupported" : "Unavailable"}`));
      return null;
    }
  };

  const doReplan = async (ev: RouteEvent) => {
    const ok = await useWalk.getState().replan(ev);
    if (ok) {
      setChangeOpen(false);
      setSheet("half");
      if (useWalk.getState().session?.finished) setFinishedNote(true);
    }
  };

  const title = s ? t("walk.title") : t("walk.planTitle");

  return (
    <div className="page-h relative overflow-hidden md:grid md:grid-cols-[420px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] md:gap-4 md:overflow-visible">
      <h1 className="sr-only">{title}</h1>
      <div className="absolute inset-0 md:static md:order-2 md:overflow-hidden md:rounded-xl md:border">
        <MapView
          points={null}
          selected={null}
          origin={startPt ? { lat: startPt.latitude, lon: startPt.longitude } : null}
          radiusKm={0}
          showRadius={false}
          aiPicks={picks}
          aiFocus={0}
          route={geometry}
          routeFocus={focus}
          picking={picking}
          lang={i18n.language}
          theme={theme}
          onSelect={() => undefined}
          onPick={(lat, lon) => {
            setStart({ latitude: lat, longitude: lon, source: "manual" });
            setPicking(false);
            setSheet("half");
          }}
          onError={() => undefined}
        />
        {picking && (
          <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-lg">{t("explore.pickHint")}</div>
        )}
      </div>

      <RouteSheet
        state={sheet}
        onState={setSheet}
        label={title}
        header={
          s && route ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-bold">{t("walk.title")}</h2>
                {w.pending && <Loader2 className="h-5 w-5 animate-spin text-primary" aria-label={t("walk.loading")} />}
              </div>
              <Totals route={route} remaining={remainingMinutes(s)} />
            </div>
          ) : (
            <h2 className="text-lg font-bold">{t("walk.planTitle")}</h2>
          )
        }
      >
        <div className="space-y-3 pt-1">
          {w.error && (
            <div role="alert" className="flex items-start justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
              {errorText(w.error, t)}
              <button type="button" onClick={w.clearError} aria-label={t("common.close")}><X className="h-4 w-4" /></button>
            </div>
          )}
          {finishedNote && !s && <p role="status" className="rounded-xl bg-accent px-3 py-2 text-sm text-accent-foreground">{t("walk.finished")}</p>}

          {s && route ? (
            <>
              {s.change && <ChangeSummary change={s.change} />}
              <Notices route={route} />
              {route.status === "no_feasible" ? (
                <p className="text-sm text-muted-foreground">{t("walk.noFeasible")}</p>
              ) : (
                <StopList route={route} busy={w.pending} onVisited={(id) => doReplan({ type: "visited", poi_id: id })} onSkip={(id) => doReplan({ type: "skip", poi_id: id })} />
              )}
              <div className="grid grid-cols-2 gap-2">
                <button type="button" disabled={w.pending} onClick={() => setChangeOpen(true)} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">
                  <Shuffle className="h-4 w-4" /> {t("walk.changeRoute")}
                </button>
                <button type="button" onClick={() => { w.finish(); setFinishedNote(true); }} className="flex h-12 items-center justify-center gap-2 rounded-2xl border text-sm font-semibold">
                  <Flag className="h-4 w-4" /> {t("walk.finish")}
                </button>
              </div>
              <WhyRoute route={route} />
              <WeatherCard lat={(s.current ?? s.start).latitude} lon={(s.current ?? s.start).longitude} minutes={remainingMinutes(s) || 60} compact />
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{t("walk.planHint")}</p>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">{t("walk.startFrom")}</p>
                <div className="flex flex-wrap gap-2">
                  <Chip on={start?.source === "geolocation"} onClick={async () => { const p = await locate(); if (p) setStart(p); }}><LocateFixed className="h-4 w-4" /> {t("walk.startMyLocation")}</Chip>
                  <Chip on={start?.source === "manual"} onClick={() => { setPicking(true); setSheet("collapsed"); }}><Crosshair className="h-4 w-4" /> {start?.source === "manual" ? t("walk.startChosen") : t("walk.startPickOnMap")}</Chip>
                  <Chip on={start?.source === "default_city_center"} onClick={() => setStart(CENTER)}><MapPin className="h-4 w-4" /> {t("walk.startCenter")}</Chip>
                </div>
                {geoError && <p role="alert" className="text-xs text-muted-foreground">{geoError}</p>}
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">{t("walk.time")}</p>
                <div className="flex flex-wrap gap-2">{TIMES.map((m) => <Chip key={m} on={minutes === m} onClick={() => setMinutes(m)}>{t("walk.minutes", { n: m })}</Chip>)}</div>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">{t("walk.places")}</p>
                <div className="flex gap-2">{[1, 2, 3].map((n) => <Chip key={n} on={places === n} onClick={() => setPlaces(n)}>{n}</Chip>)}</div>
              </div>
              <button
                type="button"
                disabled={!start || w.pending}
                onClick={() => start && w.plan({ start, time_minutes: minutes, places_count: places })}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
              >
                {w.pending ? <><Loader2 className="h-5 w-5 animate-spin" /> {t("walk.planning")}</> : <><Sparkles className="h-5 w-5" /> {t("walk.planButton")}</>}
              </button>
              {w.draft && (
                <div className="space-y-3 border-t pt-3">
                  <Totals route={w.draft} />
                  <Notices route={w.draft} />
                  {w.draft.stops.length > 0 && <StopList route={w.draft} />}
                  {w.draft.stops.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={w.start} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground">
                        <Footprints className="h-4 w-4" /> {t("walk.startWalk")}
                      </button>
                      <button type="button" onClick={w.discardDraft} className="h-12 rounded-2xl border text-sm font-semibold">{t("walk.discard")}</button>
                    </div>
                  )}
                  <WhyRoute route={w.draft} />
                </div>
              )}
              {start && <WeatherCard lat={start.latitude} lon={start.longitude} minutes={minutes} />}
              {start && <StartLabel source={start.source} label={start.label} />}
            </>
          )}
        </div>
      </RouteSheet>

      <ChangeRoute open={changeOpen} onClose={() => setChangeOpen(false)} onEvent={doReplan} locate={locate} geoError={geoError} />
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
      {w.error && <p role="alert" className="mb-2 text-sm text-red-700">{errorText(w.error, t)}</p>}
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
          {s.route.stops.map((st) =>
            row(<Shuffle className="h-5 w-5" />, st.name ?? t(`categorySingular.${st.category}`), () => onEvent({ type: "reject", poi_id: st.poi_id })),
          )}
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
