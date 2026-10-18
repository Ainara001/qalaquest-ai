import { CloudSun, Footprints, Layers, LocateFixed, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { FilterChips } from "@/components/map/FilterChips";
import { MapSheet } from "@/components/map/MapSheet";
import { MapView, type Highlight } from "@/components/map/MapView";
import { MapPickers } from "@/components/map/Pickers";
import { PlaceHeader, PlacePanel } from "@/components/map/PlacePanel";
import { ResultsHeader, ResultsPanel } from "@/components/map/ResultsPanel";
import { SearchBar, SearchPanel } from "@/components/map/Search";
import { ActiveWalkPanel, PlanWalkPanel, RoutePreviewPanel, WalkHeader } from "@/components/walk/WalkPanels";
import { useLocate } from "@/hooks/useLocate";
import { useMapPoints, usePoiQuery } from "@/hooks/usePois";
import { cn } from "@/lib/utils";
import { useWalkContext } from "@/stores/context";
import { useExplore, type AiPick } from "@/stores/explore";
import { useGuide } from "@/stores/guide";
import { useMapUi, type SheetState } from "@/stores/mapui";
import { useProfile } from "@/stores/profile";
import { TOP_PINS, useRecs } from "@/stores/recs";
import { useTheme } from "@/stores/theme";
import { remainingMinutes, useWalk } from "@/stores/walk";

const SHEET_PX: Record<SheetState, (h: number) => number> = { collapsed: () => 116, half: (h) => h * 0.5, full: (h) => h - 116 };

/** Keeps the recommendation layer in sync with the walk context (mood, time, budget, place, profile, language). */
function useRecommendationSync() {
  const { i18n } = useTranslation();
  const c = useWalkContext();
  const ex = useExplore();
  const prof = useProfile();
  useEffect(() => {
    const id = setTimeout(() => void useRecs.getState().load(), 250);
    return () => clearTimeout(id);
  }, [
    c.mood, c.timeMinutes, c.budget, c.allowUnconfirmedFree, c.withChildren, c.useWeather, c.aiWishes,
    ex.origin?.lat, ex.origin?.lon, ex.radiusKm, ex.categories, prof.prefs, prof.feedback, prof.personalize, i18n.language,
  ]);
}

/**
 * Main screen (stage 6, map first): the map of Astana with search, quick filters, mood, the recommendation layer,
 * place cards, quick routes and the active walk — all over the map, without moving between pages.
 */
export function MapHome() {
  const { t, i18n } = useTranslation();
  const { theme } = useTheme();
  const ui = useMapUi();
  const ex = useExplore();
  const ctx = useWalkContext();
  const recs = useRecs();
  const walk = useWalk();
  const aiPicksFromGuide = useExplore((s) => s.aiPicks);
  const guidePending = useGuide((g) => g.pending);
  const query = usePoiQuery();
  const points = useMapPoints(query);
  const locate = useLocate();
  const root = useRef<HTMLDivElement>(null);
  const [params, setParams] = useSearchParams();
  const [finishedNote, setFinishedNote] = useState(false);
  const [routeFocus, setRouteFocus] = useState(0);
  const [, setTick] = useState(0);
  useRecommendationSync();

  // every way of selecting a place (marker, list, search, AI card) opens the place card
  useEffect(() => {
    if (ex.selectedId !== null && ui.panel !== "place") ui.open("place", ui.sheet === "full" ? "full" : "half");
  }, [ex.selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // deep link from other tabs: /?panel=walk (active-walk bar) or /?panel=plan
  useEffect(() => {
    const p = params.get("panel");
    if (p === "walk" || p === "plan" || p === "route") {
      ui.open(p === "walk" && !walk.session ? "results" : p, "half");
      params.delete("panel");
      setParams(params, { replace: true });
    }
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  // picking a start point: get the sheet out of the way, bring it back afterwards
  useEffect(() => {
    if (ex.picking) ui.setSheet("collapsed");
  }, [ex.picking]); // eslint-disable-line react-hooks/exhaustive-deps

  // frame new top picks after the user changed the mood (not on every background refresh)
  const lastMood = useRef(ctx.mood);
  const focusNext = useRef(false);
  useEffect(() => {
    if (lastMood.current !== ctx.mood) focusNext.current = true;
    lastMood.current = ctx.mood;
  }, [ctx.mood]);
  useEffect(() => {
    if (recs.status === "ok" && focusNext.current && recs.results.length) {
      focusNext.current = false;
      ex.focusAiPicks();
    }
  }, [recs.status, recs.results]); // eslint-disable-line react-hooks/exhaustive-deps

  // frame a new route / walk change
  const routeKey = (ui.panel === "route" ? walk.draft?.computed_at : walk.proposal?.route.computed_at ?? walk.session?.route.computed_at) ?? null;
  useEffect(() => {
    if (routeKey && (ui.panel === "route" || ui.panel === "walk")) setRouteFocus((n) => n + 1);
  }, [routeKey, ui.panel]);

  // the active-walk bar shows the remaining time; refresh it once a minute
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const routeMode = ui.panel === "route" || ui.panel === "walk";
  // a re-plan proposal is drawn instead of the current route until the user decides
  const shownRoute = ui.panel === "route" ? walk.draft : walk.proposal && ui.panel === "walk" ? walk.proposal.route : walk.session?.route ?? null;
  const pins: AiPick[] = useMemo(() => {
    if (routeMode && shownRoute) return shownRoute.stops.map((s, i) => ({ id: s.poi_id, lat: s.latitude, lon: s.longitude, name: s.name, n: i + 1 }));
    if (ui.showAiAnswer) return aiPicksFromGuide;
    if (!ctx.recLayer) return [];
    return recs.results.slice(0, TOP_PINS).map((r, i) => ({ id: r.poi_id, lat: r.latitude, lon: r.longitude, name: r.name, n: i + 1 }));
  }, [routeMode, shownRoute, ui.showAiAnswer, aiPicksFromGuide, ctx.recLayer, recs.results]);
  const highlights: Highlight[] = useMemo(
    () => (routeMode || ui.showAiAnswer || !ctx.recLayer ? [] : recs.results.slice(TOP_PINS).map((r) => ({ id: r.poi_id, lat: r.latitude, lon: r.longitude }))),
    [routeMode, ui.showAiAnswer, ctx.recLayer, recs.results],
  );
  const dimBase = routeMode || ui.showAiAnswer || (ctx.recLayer && (!!ctx.mood || ctx.aiWishes.interests.length > 0));
  const geometry = useMemo(() => (shownRoute?.legs ?? []).map((l) => l.geometry), [shownRoute]);
  const selected = useMemo(() => {
    if (ex.selectedId === null) return null;
    const f = points.data?.features.find((x) => x.properties.id === ex.selectedId);
    if (f) return { id: ex.selectedId, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
    const r = recs.results.find((x) => x.poi_id === ex.selectedId) ?? null;
    if (r) return { id: r.poi_id, lat: r.latitude, lon: r.longitude };
    const a = pins.find((x) => x.id === ex.selectedId);
    return a ? { id: a.id, lat: a.lat, lon: a.lon } : null;
  }, [ex.selectedId, points.data, recs.results, pins]);

  const h = root.current?.clientHeight ?? window.innerHeight;
  const sheetPx = SHEET_PX[ui.sheet](h);
  const label = t(`mapHome.panel.${ui.panel}`);

  let header: React.ReactNode;
  let body: React.ReactNode;
  switch (ui.panel) {
    case "place":
      header = ex.selectedId !== null ? <PlaceHeader id={ex.selectedId} /> : <ResultsHeader />;
      body = ex.selectedId !== null ? <PlacePanel id={ex.selectedId} /> : <ResultsPanel query={query} />;
      break;
    case "route":
      header = <WalkHeader mode="route" />;
      body = <RoutePreviewPanel />;
      break;
    case "walk":
      header = <WalkHeader mode="walk" />;
      body = <ActiveWalkPanel onFinished={() => { setFinishedNote(true); ui.open("results", "collapsed"); }} />;
      break;
    case "plan":
      header = <WalkHeader mode="plan" />;
      body = <PlanWalkPanel />;
      break;
    default:
      header = <ResultsHeader />;
      body = <ResultsPanel query={query} />;
  }

  return (
    <div ref={root} className="page-h relative overflow-hidden md:flex md:gap-4 md:p-4">
      <h1 className="sr-only">{t("nav.map")}</h1>

      {/* map */}
      <div className="absolute inset-0 md:relative md:order-2 md:min-w-0 md:flex-1 md:overflow-hidden md:rounded-2xl md:border">
        <MapView
          points={points.data}
          selected={selected}
          origin={routeMode && shownRoute ? { lat: shownRoute.start.latitude, lon: shownRoute.start.longitude } : ex.origin}
          radiusKm={ex.radiusKm}
          showRadius={!routeMode}
          aiPicks={pins}
          aiFocus={ex.aiFocus}
          highlights={highlights}
          dimBase={dimBase}
          route={walk.session || ui.panel === "route" ? geometry : []}
          routeFocus={routeFocus}
          picking={ex.picking}
          lang={i18n.language}
          theme={theme}
          bottomInset={ui.sheet === "full" ? Math.round(h * 0.5) : Math.round(sheetPx)}
          onSelect={ex.select}
          onPick={(lat, lon) => {
            ex.setOrigin({ lat, lon, source: "manual" });
            ui.setSheet("half");
          }}
          onError={() => undefined}
        />
        {points.error && (
          <div role="alert" className="absolute left-1/2 top-[8.5rem] z-10 -translate-x-1/2 rounded-md border bg-card px-3 py-1.5 text-xs shadow md:top-3">{t("explore.mapLoadError")}</div>
        )}

        {/* floating actions: weather, recommendation layer, my location */}
        <div
          className={cn("absolute right-3 z-10 flex flex-col items-end gap-2 transition-[bottom] duration-200 md:!bottom-4", ui.sheet === "full" && "max-md:hidden")}
          style={{ bottom: `${Math.round(sheetPx) + 12}px` }}
        >
          <button type="button" onClick={() => ui.setPicker("weather")} aria-label={t("filters.weatherTitle")} className={cn("flex h-10 items-center gap-1.5 rounded-full border bg-card px-3 text-xs font-medium shadow-md", recs.weather && recs.weather.level !== "comfortable" && "border-amber-300 bg-amber-50 dark:bg-amber-950")}>
            <CloudSun className="h-4 w-4 text-[hsl(var(--brand))]" />
            {recs.weather ? t(`weather.level.${recs.weather.level}`) : t("filters.weatherShort")}
          </button>
          <button
            type="button"
            aria-pressed={ctx.recLayer}
            onClick={() => ctx.setRecLayer(!ctx.recLayer)}
            aria-label={t("filters.recLayer")}
            title={t("filters.recLayer")}
            className={cn("flex h-11 w-11 items-center justify-center rounded-full border shadow-md active:scale-95", ctx.recLayer ? "bg-primary text-primary-foreground" : "bg-card")}
          >
            <Layers className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={locate.locate}
            disabled={locate.state === "locating"}
            aria-label={t("explore.myLocation")}
            className={cn("flex h-11 w-11 items-center justify-center rounded-full border shadow-md active:scale-95", ex.origin?.source === "geolocation" ? "bg-primary text-primary-foreground" : "bg-card")}
          >
            {locate.state === "locating" ? <Loader2 className="h-5 w-5 animate-spin" /> : <LocateFixed className="h-5 w-5" />}
          </button>
        </div>
      </div>

      <aside className="contents md:order-1 md:flex md:min-h-0 md:w-[400px] md:shrink-0 md:flex-col md:gap-3">
        {/* search + quick filters + active walk: on top of the map on phones, top of the side panel on desktop */}
        <div className="absolute inset-x-0 top-0 z-30 space-y-2 px-3 pt-[calc(var(--safe-t)+0.75rem)] md:static md:z-auto md:space-y-3 md:p-0">
          <SearchBar />
          <FilterChips />
          {ex.picking && (
            <div className="flex items-center justify-between gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg">
              {t("explore.pickHint")}
              <button type="button" onClick={() => ex.setPicking(false)} aria-label={t("common.cancel")}><X className="h-5 w-5" /></button>
            </div>
          )}
          {walk.session && ui.panel !== "walk" && !ex.picking && (
            <button type="button" onClick={() => ui.open("walk", "half")} className="flex w-full items-center gap-2 rounded-2xl bg-accent px-4 py-2.5 text-left text-sm font-medium text-accent-foreground shadow-md">
              <Footprints className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {t("walk.statusPill", { count: walk.session.route.stops.length, min: remainingMinutes(walk.session) })}
                {walk.proposal ? ` · ${t("walk.proposal.pending")}` : (walk.session.prefs.mood ?? null) !== ctx.mood ? ` · ${t("walk.moodChangedShort")}` : ""}
              </span>
              <span className="shrink-0 font-semibold underline underline-offset-2">{t("walk.open")}</span>
            </button>
          )}
          {finishedNote && !walk.session && (
            <p role="status" className="flex items-center justify-between gap-2 rounded-2xl bg-accent px-4 py-2.5 text-sm text-accent-foreground shadow-md">
              {t("walk.finished")}
              <button type="button" onClick={() => setFinishedNote(false)} aria-label={t("common.close")}><X className="h-4 w-4" /></button>
            </p>
          )}
          {guidePending && ui.showAiAnswer && ui.panel !== "results" && (
            <p className="flex items-center gap-2 rounded-2xl bg-card px-4 py-2 text-sm shadow-md"><Loader2 className="h-4 w-4 animate-spin text-primary" /> {t("guide.thinking")}</p>
          )}
        </div>

        <MapSheet state={ui.sheet} onState={ui.setSheet} label={label} header={header}>
          {body}
        </MapSheet>
      </aside>

      <SearchPanel />
      <MapPickers />
    </div>
  );
}
