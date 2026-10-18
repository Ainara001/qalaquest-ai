import { Check, Crosshair, LocateFixed, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/BottomSheet";
import { CategoryChips } from "@/components/explore/parts";
import { MOOD_ICONS } from "@/components/icons";
import { WeatherCard } from "@/components/WeatherCard";
import { useLocate } from "@/hooks/useLocate";
import { cn } from "@/lib/utils";
import { MOODS, RADIUS_OPTIONS, TIME_OPTIONS, useWalkContext, type SessionBudget } from "@/stores/context";
import { useExplore } from "@/stores/explore";
import { useMapUi } from "@/stores/mapui";
import { isConfigured, personalizationOn, useProfile } from "@/stores/profile";

const BUDGETS: SessionBudget[] = ["free", "2000", "5000", "10000"];

function Option({ on, onClick, children, className }: { on: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("flex min-h-12 items-center gap-2 rounded-2xl border px-4 text-left text-sm font-medium", on ? "border-primary bg-accent text-accent-foreground" : "bg-background", className)}
    >
      {children}
      {on && <Check className="ml-auto h-4 w-4 shrink-0" />}
    </button>
  );
}

function Toggle({ on, onChange, title, hint }: { on: boolean; onChange: (v: boolean) => void; title: string; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex w-full items-center justify-between gap-3 rounded-2xl border bg-background px-4 py-3 text-left">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <span className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-muted-foreground/30")}>
        <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", on ? "left-[1.375rem]" : "left-0.5")} />
      </span>
    </button>
  );
}

/** Mood of the current walk: one tap selects and closes; never saved to the profile. */
export function MoodPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { mood, setMood } = useWalkContext();
  return (
    <BottomSheet open={open} onClose={onClose} title={t("filters.moodTitle")}>
      <p className="mb-3 text-xs text-muted-foreground">{t("filters.moodHint")}</p>
      <div className="grid grid-cols-3 gap-2">
        {MOODS.map((m) => {
          const Icon = MOOD_ICONS[m];
          const on = mood === m;
          return (
            <button
              key={m}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setMood(on ? null : m);
                onClose();
              }}
              className={cn(
                "flex min-h-[5.25rem] flex-col items-center justify-center gap-1.5 rounded-2xl border px-1.5 py-2 text-center text-[13px] font-medium leading-tight transition active:scale-95",
                on ? "border-primary bg-primary text-primary-foreground" : "bg-background",
              )}
            >
              <Icon className={cn("h-6 w-6", !on && "text-[hsl(var(--brand))]")} />
              {t(`mood.${m}`)}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        disabled={!mood}
        onClick={() => {
          setMood(null);
          onClose();
        }}
        className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border text-sm font-semibold disabled:opacity-40"
      >
        <RotateCcw className="h-4 w-4" /> {t("filters.moodReset")}
      </button>
    </BottomSheet>
  );
}

/** All picker sheets of the map; only the one in `useMapUi().picker` is open. */
export function MapPickers() {
  const { t } = useTranslation();
  const ui = useMapUi();
  const c = useWalkContext();
  const ex = useExplore();
  const prof = useProfile();
  const loc = useLocate();
  const close = () => ui.setPicker(null);
  const configured = isConfigured(prof.prefs) || Object.values(prof.feedback).some((l) => l.length > 0);

  return (
    <>
      <MoodPicker open={ui.picker === "mood"} onClose={close} />

      <BottomSheet open={ui.picker === "time"} onClose={close} title={t("filters.timeTitle")}>
        <div className="grid grid-cols-2 gap-2">
          {TIME_OPTIONS.map((m) => (
            <Option key={m} on={c.timeMinutes === m} onClick={() => { c.setTime(m); close(); }}>{t("filters.timeValue", { n: m })}</Option>
          ))}
          <Option on={!c.timeMinutes} onClick={() => { c.setTime(null); close(); }}>{t("filters.timeAny")}</Option>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t("filters.timeHint")}</p>
      </BottomSheet>

      <BottomSheet open={ui.picker === "budget"} onClose={close} title={t("filters.budgetTitle")}>
        <div className="grid gap-2">
          {BUDGETS.map((b) => (
            <Option key={b} on={c.budget === b} onClick={() => { c.setBudget(b); close(); }}>{t(`filters.budgetOption.${b}`)}</Option>
          ))}
          <Option on={!c.budget} onClick={() => { c.setBudget(null); close(); }}>{t("filters.budgetAny")}</Option>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t("filters.budgetHint")}</p>
      </BottomSheet>

      <BottomSheet open={ui.picker === "categories"} onClose={close} title={t("filters.categoriesTitle")}>
        <CategoryChips />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" disabled={!ex.categories.length} onClick={() => ex.categories.forEach((x) => ex.toggleCategory(x))} className="h-11 rounded-2xl border text-sm font-semibold disabled:opacity-40">
            {t("filters.reset")}
          </button>
          <button type="button" onClick={close} className="h-11 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground">{t("filters.done")}</button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t("filters.categoriesHint")}</p>
      </BottomSheet>

      <BottomSheet open={ui.picker === "near"} onClose={close} title={t("filters.nearTitle")}>
        {loc.state !== "idle" && loc.state !== "locating" && (
          <p role="alert" className="mb-3 rounded-xl bg-muted px-3 py-2 text-[13px] text-muted-foreground">{t(`explore.geo${loc.state[0].toUpperCase()}${loc.state.slice(1)}`)}</p>
        )}
        {ex.origin && (
          <>
            <p className="mb-2 text-xs font-medium text-muted-foreground">{t("filters.radius")}</p>
            <div className="mb-3 grid grid-cols-4 gap-2">
              {RADIUS_OPTIONS.map((km) => (
                <Option key={km} on={ex.radiusKm === km} onClick={() => ex.setRadiusKm(km)} className="justify-center px-2">{t("explore.radiusValue", { km })}</Option>
              ))}
            </div>
          </>
        )}
        <div className="grid gap-2">
          <Option on={ex.origin?.source === "geolocation"} onClick={async () => { if (await loc.locate()) close(); }}>
            <LocateFixed className="h-4 w-4" /> {loc.state === "locating" ? t("explore.locating") : t("filters.useMyLocation")}
          </Option>
          <Option on={ex.origin?.source === "manual"} onClick={() => { ex.setPicking(true); close(); }}>
            <Crosshair className="h-4 w-4" /> {t("explore.pickOnMap")}
          </Option>
          {ex.origin && (
            <button type="button" onClick={() => { ex.setOrigin(null); close(); }} className="h-11 rounded-2xl border text-sm font-semibold">{t("filters.wholeCity")}</button>
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t("filters.nearHint")}</p>
      </BottomSheet>

      <BottomSheet open={ui.picker === "filters"} onClose={close} title={t("filters.moreTitle")}>
        <div className="grid gap-2">
          <Toggle on={c.withChildren} onChange={c.setWithChildren} title={t("filters.withChildren")} />
          <Toggle on={prof.prefs.wheelchair} onChange={(v) => prof.setPrefs({ wheelchair: v })} title={t("filters.wheelchair")} hint={t("filters.wheelchairHint")} />
          <Toggle on={c.useWeather} onChange={c.setUseWeather} title={t("filters.useWeather")} hint={t("filters.useWeatherHint")} />
          <Toggle on={c.recLayer} onChange={c.setRecLayer} title={t("filters.recLayer")} hint={t("filters.recLayerHint")} />
          {configured && <Toggle on={personalizationOn(prof)} onChange={prof.setPersonalize} title={t("guide.personalize")} hint={t("filters.profileHint")} />}
          {c.budget === "free" && <Toggle on={c.allowUnconfirmedFree} onChange={c.setAllowUnconfirmedFree} title={t("guide.showUnconfirmedFree")} />}
        </div>
        <button type="button" onClick={() => { c.resetFilters(); ex.reset(); close(); }} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border text-sm font-semibold">
          <RotateCcw className="h-4 w-4" /> {t("filters.resetAll")}
        </button>
      </BottomSheet>

      <BottomSheet open={ui.picker === "weather"} onClose={close} title={t("filters.weatherTitle")}>
        <WeatherCard lat={ex.origin?.lat} lon={ex.origin?.lon} minutes={c.timeMinutes ?? 90} />
        <p className="mt-3 text-xs text-muted-foreground">{c.useWeather ? t("filters.weatherUsed") : t("filters.weatherNotUsed")}</p>
      </BottomSheet>
    </>
  );
}
